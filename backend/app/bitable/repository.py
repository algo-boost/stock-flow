import asyncio
from datetime import datetime, timezone
import time
from typing import Any

from app.bitable.client import BYTableClient
from app.bitable.fields import (
    field_link_id,
    field_number,
    field_text,
    field_user_name,
    normalize_tx_type,
    write_link,
    write_user,
)
from app.config import Settings
from app.models import (
    Category,
    InventoryItem,
    Location,
    Material,
    MaterialCreate,
    MaterialDetail,
    MaterialSearchItem,
    Transaction,
    TransactionType,
)

_TABLE_CACHE: dict[tuple[str, str], tuple[float, list[dict[str, Any]]]] = {}
_TABLE_INFLIGHT: dict[tuple[str, str], asyncio.Task[list[dict[str, Any]]]] = {}


class BitableRepository:
    """Bitable real 模式：读写五表（字段名可通过 Settings 配置）。"""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.client = BYTableClient(settings)
        self._materials_cache: dict[str, Material] | None = None
        self._locations_cache: dict[str, Location] | None = None

    async def _list_all(self, table_id: str) -> list[dict[str, Any]]:
        if not table_id:
            return []
        ttl = max(self.settings.bitable_cache_ttl_seconds, 0)
        cache_key = (self.settings.bitable_app_token, table_id)
        now = time.monotonic()
        if ttl > 0 and cache_key in _TABLE_CACHE:
            cached_at, records = _TABLE_CACHE[cache_key]
            if now - cached_at <= ttl:
                return records

        inflight = _TABLE_INFLIGHT.get(cache_key)
        if inflight:
            records = await inflight
        else:
            task = asyncio.create_task(self.client.list_records(table_id))
            _TABLE_INFLIGHT[cache_key] = task
            try:
                records = await task
            finally:
                _TABLE_INFLIGHT.pop(cache_key, None)
        if ttl > 0:
            _TABLE_CACHE[cache_key] = (time.monotonic(), records)
        return records

    def _invalidate_table_cache(self, *table_ids: str) -> None:
        app_token = self.settings.bitable_app_token
        for table_id in table_ids:
            if table_id:
                _TABLE_CACHE.pop((app_token, table_id), None)
                _TABLE_INFLIGHT.pop((app_token, table_id), None)

    def _upsert_cached_record(self, table_id: str, record: dict[str, Any]) -> None:
        """写操作成功后同步更新表级缓存，避免下一次读取整表。"""
        if not table_id or not record.get("record_id"):
            return
        cache_key = (self.settings.bitable_app_token, table_id)
        cached = _TABLE_CACHE.get(cache_key)
        if not cached:
            return

        cached_at, records = cached
        next_records: list[dict[str, Any]] = []
        replaced = False
        for item in records:
            if item.get("record_id") == record["record_id"]:
                merged = {
                    **item,
                    **record,
                    "fields": {
                        **item.get("fields", {}),
                        **record.get("fields", {}),
                    },
                }
                next_records.append(merged)
                replaced = True
            else:
                next_records.append(item)
        if not replaced:
            next_records.append(record)
        _TABLE_CACHE[cache_key] = (cached_at, next_records)

    def _cached_record(self, record_id: str, fields: dict[str, Any]) -> dict[str, Any]:
        return {"record_id": record_id, "fields": fields}

    async def warmup_core_tables(self) -> dict[str, str | None]:
        """预热五表缓存，降低服务重启后的首次页面等待时间。"""
        return await self._refresh_tables_best_effort(self._core_table_ids(), force=False, retries=1)

    async def refresh_core_tables(self) -> dict[str, Any]:
        """手动刷新五表缓存，用于 Bitable 直接改表后的同步。"""
        table_ids = self._core_table_ids()
        results = await self._refresh_tables_best_effort(table_ids, force=True)
        failures = {tid: msg for tid, msg in results.items() if msg}
        return {
            "tables": await self.snapshot(),
            "refreshed": [tid for tid, msg in results.items() if not msg],
            "failed": failures,
        }

    async def _refresh_tables_best_effort(
        self,
        table_ids: list[str],
        *,
        force: bool,
        retries: int = 3,
    ) -> dict[str, str | None]:
        results: dict[str, str | None] = {}
        for table_id in table_ids:
            if not table_id:
                continue
            try:
                await self._refresh_table_cache(table_id, force=force, retries=retries)
                results[table_id] = None
            except Exception as exc:
                # 刷新失败时保留旧缓存，避免把后续读操作打回全表冷加载。
                results[table_id] = str(exc)
        return results

    async def _refresh_table_cache(
        self,
        table_id: str,
        *,
        force: bool,
        retries: int = 3,
    ) -> list[dict[str, Any]]:
        if not table_id:
            return []
        cache_key = (self.settings.bitable_app_token, table_id)
        if not force and cache_key in _TABLE_CACHE:
            return _TABLE_CACHE[cache_key][1]
        records = await self.client.list_records(table_id, retries=retries)
        if self.settings.bitable_cache_ttl_seconds > 0:
            _TABLE_CACHE[cache_key] = (time.monotonic(), records)
        return records

    def _core_table_ids(self) -> list[str]:
        s = self.settings
        return [
            s.bitable_table_categories,
            s.bitable_table_locations,
            s.bitable_table_materials,
            s.bitable_table_inventory,
            s.bitable_table_transactions,
        ]

    async def _load_materials(self) -> dict[str, Material]:
        if self._materials_cache is not None:
            return self._materials_cache
        s = self.settings
        records = await self._list_all(s.bitable_table_materials)
        locations = await self._load_locations()
        categories = await self._load_categories()
        result: dict[str, Material] = {}
        for rec in records:
            fields = rec.get("fields", {})
            rid = rec["record_id"]
            cat_id = field_link_id(fields.get(s.bitable_f_material_category)) or ""
            loc_id = field_link_id(fields.get(s.bitable_f_material_default_location)) or ""
            result[rid] = Material(
                id=rid,
                code=field_text(fields.get(s.bitable_f_material_code)) or rid,
                name=field_text(fields.get(s.bitable_f_material_name)) or "未命名物料",
                category_id=cat_id,
                category_name=categories.get(cat_id),
                unit=field_text(fields.get(s.bitable_f_material_unit)) or "个",
                spec=field_text(fields.get(s.bitable_f_material_spec)),
                barcode=field_text(fields.get(s.bitable_f_material_barcode)),
                default_location_id=loc_id or None,
            )
            if loc_id and loc_id in locations and not result[rid].default_location_id:
                pass
        self._materials_cache = result
        return result

    async def _load_categories(self) -> dict[str, str]:
        s = self.settings
        if not s.bitable_table_categories:
            return {}
        records = await self._list_all(s.bitable_table_categories)
        return {
            rec["record_id"]: field_text(rec.get("fields", {}).get(s.bitable_f_category_name)) or rec["record_id"]
            for rec in records
        }

    async def list_categories(self) -> list[Category]:
        categories = await self._load_categories()
        return [Category(id=cid, name=name) for cid, name in categories.items()]

    async def _load_locations(self) -> dict[str, Location]:
        if self._locations_cache is not None:
            return self._locations_cache
        s = self.settings
        records = await self._list_all(s.bitable_table_locations)
        result: dict[str, Location] = {}
        for rec in records:
            fields = rec.get("fields", {})
            rid = rec["record_id"]
            result[rid] = Location(
                id=rid,
                code=field_text(fields.get(s.bitable_f_location_code)) or rid,
                name=field_text(fields.get(s.bitable_f_location_name)) or rid,
                type=field_text(fields.get(s.bitable_f_location_type)) or "货柜",
            )
        self._locations_cache = result
        return result

    async def search_materials(
        self,
        q: str | None,
        category: str | None,
        location: str | None,
        stock_only: bool,
        page: int,
        size: int,
    ) -> tuple[list[MaterialSearchItem], int]:
        materials = list((await self._load_materials()).values())
        inv_records = await self._load_inventory_records()
        inventory = self._inventory_map_from_records(inv_records)
        locations = await self._load_locations()

        if q:
            keyword = q.lower()
            materials = [
                m
                for m in materials
                if keyword in m.name.lower()
                or keyword in m.code.lower()
                or (m.barcode and keyword in m.barcode.lower())
            ]
        if category:
            materials = [
                m for m in materials if m.category_id == category or m.category_name == category
            ]
        if location:
            mat_ids = {mid for (mid, lid), qty in inventory.items() if lid == location and qty > 0}
            materials = [m for m in materials if m.id in mat_ids]
        if stock_only:
            mat_ids = {mid for (mid, _), qty in inventory.items() if qty > 0}
            materials = [m for m in materials if m.id in mat_ids]

        total = len(materials)
        start = (page - 1) * size
        return [
            self._to_search_item(m, inventory, locations)
            for m in materials[start : start + size]
        ], total

    def _to_search_item(
        self,
        material: Material,
        inventory: dict[tuple[str, str], int],
        locations: dict[str, Location],
    ) -> MaterialSearchItem:
        items = [
            (lid, qty)
            for (mid, lid), qty in inventory.items()
            if mid == material.id and qty > 0
        ]
        total = sum(qty for _, qty in items)
        summary = " · ".join(
            f"{locations.get(lid).name if locations.get(lid) else lid} {qty}"
            for lid, qty in items[:3]
        )
        return MaterialSearchItem(
            **material.model_dump(),
            total_quantity=total,
            locations_summary=summary or None,
        )

    async def get_material(self, material_id: str) -> Material | None:
        return (await self._load_materials()).get(material_id)

    async def create_material(self, payload: MaterialCreate) -> Material:
        categories = await self._load_categories()
        if payload.category_id not in categories:
            raise ValueError("category_not_found")
        locations = await self._load_locations()
        if payload.default_location_id and payload.default_location_id not in locations:
            raise ValueError("location_not_found")

        s = self.settings
        code = payload.code or f"MAT-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"
        fields: dict[str, Any] = {
            s.bitable_f_material_code: code,
            s.bitable_f_material_name: payload.name.strip(),
            s.bitable_f_material_category: write_link(payload.category_id),
            s.bitable_f_material_unit: payload.unit.strip() or "个",
        }
        if payload.spec:
            fields[s.bitable_f_material_spec] = payload.spec.strip()
        if payload.barcode:
            fields[s.bitable_f_material_barcode] = payload.barcode.strip()
        if payload.default_location_id:
            fields[s.bitable_f_material_default_location] = write_link(payload.default_location_id)

        rec = await self.client.create_record(s.bitable_table_materials, fields)
        rid = rec.get("record_id", "")
        self._materials_cache = None
        self._upsert_cached_record(
            s.bitable_table_materials,
            rec if rec.get("fields") else self._cached_record(rid, fields),
        )
        return Material(
            id=rid,
            code=code,
            name=payload.name.strip(),
            category_id=payload.category_id,
            category_name=categories.get(payload.category_id),
            unit=payload.unit.strip() or "个",
            spec=payload.spec.strip() if payload.spec else None,
            barcode=payload.barcode.strip() if payload.barcode else None,
            default_location_id=payload.default_location_id,
        )

    async def list_material_catalog(
        self,
        q: str | None = None,
        stock_only: bool = False,
    ) -> list[MaterialDetail]:
        """一次拉取物料 + 库存（出库选料、入库表单共用）。"""
        materials = list((await self._load_materials()).values())
        inv_records = await self._load_inventory_records()
        inv_map = self._inventory_map_from_records(inv_records)
        locations = await self._load_locations()
        s = self.settings

        if q:
            keyword = q.lower()
            materials = [
                m
                for m in materials
                if keyword in m.name.lower()
                or keyword in m.code.lower()
                or (m.barcode and keyword in m.barcode.lower())
                or (m.category_name and keyword in (m.category_name or "").lower())
            ]

        catalog: list[MaterialDetail] = []
        for m in sorted(materials, key=lambda x: x.name):
            items: list[InventoryItem] = []
            for (mid, lid), qty in inv_map.items():
                if mid != m.id or qty <= 0:
                    continue
                rec = inv_records.get((mid, lid), {})
                updated = rec.get("fields", {}).get(s.bitable_f_inventory_updated)
                last_updated = None
                if isinstance(updated, (int, float)):
                    last_updated = datetime.fromtimestamp(updated / 1000, tz=timezone.utc)
                loc = locations.get(lid)
                items.append(
                    InventoryItem(
                        material_id=mid,
                        location_id=lid,
                        location_name=loc.name if loc else lid,
                        quantity=qty,
                        last_updated=last_updated,
                    )
                )
            total = sum(i.quantity for i in items)
            if stock_only and total <= 0:
                continue
            catalog.append(
                MaterialDetail(material=m, inventory=items, total_quantity=total)
            )
        return catalog

    async def list_locations(self) -> list[Location]:
        return list((await self._load_locations()).values())

    def _build_tx_fields(
        self,
        tx_type: str,
        material_id: str,
        location_id: str,
        qty: int,
        operator_open_id: str,
        remark: str | None,
    ) -> dict[str, Any]:
        s = self.settings
        fields: dict[str, Any] = {
            s.bitable_f_tx_type: tx_type,
            s.bitable_f_tx_material: write_link(material_id),
            s.bitable_f_tx_location: write_link(location_id),
            s.bitable_f_tx_quantity: qty,
            s.bitable_f_tx_remark: remark or "",
        }
        if operator_open_id:
            fields[s.bitable_f_tx_operator] = write_user(operator_open_id)
        return fields

    async def _write_inventory_quantity(
        self,
        inv_records: dict[tuple[str, str], dict[str, Any]],
        material_id: str,
        location_id: str,
        qty: int,
        updated_at: int,
    ) -> str:
        s = self.settings
        key = (material_id, location_id)
        if key in inv_records:
            inv_fields = {
                s.bitable_f_inventory_quantity: qty,
                s.bitable_f_inventory_updated: updated_at,
            }
            record_id = inv_records[key]["record_id"]
            await self.client.update_record(
                s.bitable_table_inventory,
                record_id,
                inv_fields,
            )
            self._upsert_cached_record(
                s.bitable_table_inventory,
                self._cached_record(record_id, inv_fields),
            )
            return record_id

        inv_fields = {
            s.bitable_f_inventory_material: write_link(material_id),
            s.bitable_f_inventory_location: write_link(location_id),
            s.bitable_f_inventory_quantity: qty,
            s.bitable_f_inventory_updated: updated_at,
        }
        inv_rec = await self.client.create_record(s.bitable_table_inventory, inv_fields)
        record_id = inv_rec.get("record_id", "")
        self._upsert_cached_record(
            s.bitable_table_inventory,
            inv_rec if inv_rec.get("fields") else self._cached_record(record_id, inv_fields),
        )
        inv_records[key] = self._cached_record(record_id, inv_fields)
        return record_id

    async def _load_inventory_map(self) -> dict[tuple[str, str], int]:
        return self._inventory_map_from_records(await self._load_inventory_records())

    def _inventory_map_from_records(
        self, records: dict[tuple[str, str], dict[str, Any]]
    ) -> dict[tuple[str, str], int]:
        s = self.settings
        result: dict[tuple[str, str], int] = {}
        for key, rec in records.items():
            result[key] = field_number(rec.get("fields", {}).get(s.bitable_f_inventory_quantity))
        return result

    async def _load_inventory_records(self) -> dict[tuple[str, str], dict[str, Any]]:
        s = self.settings
        records = await self._list_all(s.bitable_table_inventory)
        result: dict[tuple[str, str], dict[str, Any]] = {}
        for rec in records:
            fields = rec.get("fields", {})
            mid = field_link_id(fields.get(s.bitable_f_inventory_material))
            lid = field_link_id(fields.get(s.bitable_f_inventory_location))
            if mid and lid:
                result[(mid, lid)] = rec
        return result

    async def get_inventory_for_material(self, material_id: str) -> list[InventoryItem]:
        locations = await self._load_locations()
        inv_records = await self._load_inventory_records()
        inv_map = self._inventory_map_from_records(inv_records)
        items: list[InventoryItem] = []
        for (mid, lid), qty in inv_map.items():
            if mid != material_id or qty <= 0:
                continue
            rec = inv_records.get((mid, lid), {})
            updated = rec.get("fields", {}).get(self.settings.bitable_f_inventory_updated)
            last_updated = None
            if isinstance(updated, (int, float)):
                last_updated = datetime.fromtimestamp(updated / 1000, tz=timezone.utc)
            loc = locations.get(lid)
            items.append(
                InventoryItem(
                    material_id=mid,
                    location_id=lid,
                    location_name=loc.name if loc else lid,
                    quantity=qty,
                    last_updated=last_updated,
                )
            )
        return items

    async def list_inventory(
        self, material_id: str | None, location_id: str | None
    ) -> list[InventoryItem]:
        locations = await self._load_locations()
        inv_records = await self._load_inventory_records()
        all_items: list[InventoryItem] = []
        for (mid, lid), rec in inv_records.items():
            if material_id and mid != material_id:
                continue
            if location_id and lid != location_id:
                continue
            fields = rec.get("fields", {})
            qty = field_number(fields.get(self.settings.bitable_f_inventory_quantity))
            if qty <= 0:
                continue
            updated = fields.get(self.settings.bitable_f_inventory_updated)
            last_updated = None
            if isinstance(updated, (int, float)):
                last_updated = datetime.fromtimestamp(updated / 1000, tz=timezone.utc)
            loc = locations.get(lid)
            all_items.append(
                InventoryItem(
                    material_id=mid,
                    location_id=lid,
                    location_name=loc.name if loc else lid,
                    quantity=qty,
                    last_updated=last_updated,
                )
            )
        return all_items

    async def get_transactions(self, material_id: str, limit: int) -> list[Transaction]:
        s = self.settings
        materials = await self._load_materials()
        locations = await self._load_locations()
        records = await self._list_all(s.bitable_table_transactions)
        txs: list[Transaction] = []
        for rec in records:
            fields = rec.get("fields", {})
            mid = field_link_id(fields.get(s.bitable_f_tx_material))
            if mid != material_id:
                continue
            lid = field_link_id(fields.get(s.bitable_f_tx_location)) or ""
            tx_type_raw = field_text(fields.get(s.bitable_f_tx_type)) or "out"
            normalized = normalize_tx_type(tx_type_raw)
            if normalized == "入库":
                tx_enum = TransactionType.INBOUND
            elif normalized == "移动":
                tx_enum = TransactionType.TRANSFER
            else:
                tx_enum = TransactionType.OUTBOUND
            created = fields.get(s.bitable_f_tx_created)
            created_at = datetime.now(timezone.utc)
            if isinstance(created, (int, float)):
                created_at = datetime.fromtimestamp(created / 1000, tz=timezone.utc)
            material = materials.get(mid)
            loc = locations.get(lid)
            txs.append(
                Transaction(
                    id=rec["record_id"],
                    type=tx_enum,
                    material_id=mid,
                    material_name=material.name if material else None,
                    location_id=lid,
                    location_name=loc.name if loc else lid,
                    quantity=field_number(fields.get(s.bitable_f_tx_quantity)),
                    operator=field_user_name(fields.get(s.bitable_f_tx_operator)) or "未知",
                    remark=field_text(fields.get(s.bitable_f_tx_remark)),
                    created_at=created_at,
                )
            )
        txs.sort(key=lambda t: t.created_at, reverse=True)
        return txs[:limit]

    async def apply_inbound(
        self,
        material_id: str,
        location_id: str,
        qty: int,
        operator_open_id: str,
        operator_name: str,
        remark: str | None,
    ) -> Transaction:
        if not await self.get_material(material_id):
            raise ValueError("material_not_found")
        locations = await self._load_locations()
        if location_id not in locations:
            raise ValueError("location_not_found")

        inv_records = await self._load_inventory_records()
        key = (material_id, location_id)
        s = self.settings
        current = field_number(
            inv_records.get(key, {}).get("fields", {}).get(s.bitable_f_inventory_quantity)
        )
        new_qty = current + qty
        updated_at = int(datetime.now(timezone.utc).timestamp() * 1000)

        await self._write_inventory_quantity(inv_records, material_id, location_id, new_qty, updated_at)

        tx_fields = self._build_tx_fields(
            s.bitable_v_tx_inbound,
            material_id,
            location_id,
            qty,
            operator_open_id,
            remark,
        )
        try:
            tx_rec = await self.client.create_record(s.bitable_table_transactions, tx_fields)
        except Exception:
            await self._write_inventory_quantity(inv_records, material_id, location_id, current, updated_at)
            raise
        self._upsert_cached_record(
            s.bitable_table_transactions,
            tx_rec if tx_rec.get("fields") else self._cached_record(tx_rec.get("record_id", ""), tx_fields),
        )
        material = (await self._load_materials())[material_id]
        loc = locations[location_id]
        return Transaction(
            id=tx_rec.get("record_id", "tx_new"),
            type=TransactionType.INBOUND,
            material_id=material_id,
            material_name=material.name,
            location_id=location_id,
            location_name=loc.name,
            quantity=qty,
            operator=operator_name,
            remark=remark,
            created_at=datetime.now(timezone.utc),
        )

    async def apply_outbound(
        self,
        material_id: str,
        location_id: str,
        qty: int,
        operator_open_id: str,
        operator_name: str,
        remark: str | None,
    ) -> Transaction:
        if not await self.get_material(material_id):
            raise ValueError("material_not_found")
        inv_records = await self._load_inventory_records()
        key = (material_id, location_id)
        s = self.settings
        if key not in inv_records:
            raise ValueError("insufficient_stock:0")
        current = field_number(inv_records[key]["fields"].get(s.bitable_f_inventory_quantity))
        if current < qty:
            raise ValueError(f"insufficient_stock:{current}")

        updated_at = int(datetime.now(timezone.utc).timestamp() * 1000)
        await self._write_inventory_quantity(inv_records, material_id, location_id, current - qty, updated_at)
        tx_fields = self._build_tx_fields(
            s.bitable_v_tx_outbound,
            material_id,
            location_id,
            -qty,
            operator_open_id,
            remark,
        )
        try:
            tx_rec = await self.client.create_record(s.bitable_table_transactions, tx_fields)
        except Exception:
            await self._write_inventory_quantity(inv_records, material_id, location_id, current, updated_at)
            raise
        self._upsert_cached_record(
            s.bitable_table_transactions,
            tx_rec if tx_rec.get("fields") else self._cached_record(tx_rec.get("record_id", ""), tx_fields),
        )
        materials = await self._load_materials()
        locations = await self._load_locations()
        return Transaction(
            id=tx_rec.get("record_id", "tx_new"),
            type=TransactionType.OUTBOUND,
            material_id=material_id,
            material_name=materials[material_id].name,
            location_id=location_id,
            location_name=locations.get(location_id, Location(id=location_id, code="", name=location_id)).name,
            quantity=-qty,
            operator=operator_name,
            remark=remark,
            created_at=datetime.now(timezone.utc),
        )

    async def apply_transfer(
        self,
        material_id: str,
        from_location_id: str,
        to_location_id: str,
        qty: int,
        operator_open_id: str,
        operator_name: str,
        remark: str | None,
    ) -> list[Transaction]:
        if from_location_id == to_location_id:
            raise ValueError("same_location")
        if not await self.get_material(material_id):
            raise ValueError("material_not_found")

        locations = await self._load_locations()
        if from_location_id not in locations or to_location_id not in locations:
            raise ValueError("location_not_found")

        inv_records = await self._load_inventory_records()
        source_key = (material_id, from_location_id)
        target_key = (material_id, to_location_id)
        s = self.settings
        source_current = field_number(
            inv_records.get(source_key, {}).get("fields", {}).get(s.bitable_f_inventory_quantity)
        )
        if source_current < qty:
            raise ValueError(f"insufficient_stock:{source_current}")
        target_current = field_number(
            inv_records.get(target_key, {}).get("fields", {}).get(s.bitable_f_inventory_quantity)
        )

        updated_at = int(datetime.now(timezone.utc).timestamp() * 1000)
        await self._write_inventory_quantity(
            inv_records,
            material_id,
            from_location_id,
            source_current - qty,
            updated_at,
        )
        try:
            await self._write_inventory_quantity(
                inv_records,
                material_id,
                to_location_id,
                target_current + qty,
                updated_at,
            )
        except Exception:
            await self._write_inventory_quantity(
                inv_records,
                material_id,
                from_location_id,
                source_current,
                updated_at,
            )
            raise

        source_loc = locations[from_location_id]
        target_loc = locations[to_location_id]
        tx_fields = self._build_tx_fields(
            s.bitable_v_tx_transfer,
            material_id,
            from_location_id,
            -qty,
            operator_open_id,
            f"移动至 {target_loc.name}" + (f"；{remark}" if remark else ""),
        )
        try:
            tx_rec = await self.client.create_record(s.bitable_table_transactions, tx_fields)
        except Exception:
            await self._write_inventory_quantity(
                inv_records,
                material_id,
                from_location_id,
                source_current,
                updated_at,
            )
            await self._write_inventory_quantity(
                inv_records,
                material_id,
                to_location_id,
                target_current,
                updated_at,
            )
            raise

        self._upsert_cached_record(
            s.bitable_table_transactions,
            tx_rec if tx_rec.get("fields") else self._cached_record(tx_rec.get("record_id", ""), tx_fields),
        )

        material = (await self._load_materials())[material_id]
        now = datetime.now(timezone.utc)
        return [
            Transaction(
                id=tx_rec.get("record_id", "tx_transfer"),
                type=TransactionType.TRANSFER,
                material_id=material_id,
                material_name=material.name,
                location_id=from_location_id,
                location_name=source_loc.name,
                quantity=-qty,
                operator=operator_name,
                remark=tx_fields.get(s.bitable_f_tx_remark),
                created_at=now,
            ),
        ]

    def _invalidate_cache(self, *table_ids: str) -> None:
        s = self.settings
        if not table_ids or s.bitable_table_materials in table_ids:
            self._materials_cache = None
        if not table_ids or s.bitable_table_locations in table_ids:
            self._locations_cache = None
        self._invalidate_table_cache(*(table_ids or tuple(self._core_table_ids())))

    async def snapshot(self) -> dict[str, int]:
        return {
            "materials": len(await self._load_materials()),
            "locations": len(await self._load_locations()),
            "inventory": len(await self._load_inventory_map()),
        }
