from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import time
from typing import Any

from app.bitable.client import BYTableClient
from app.bitable.fields import (
    field_link_id,
    field_number,
    field_text,
    field_user_id,
    field_user_name,
    normalize_tx_type,
    write_link,
    write_user,
)
from app.config import Settings
from app.models import (
    Category,
    CategoryCreate,
    InventoryItem,
    Location,
    LocationCreate,
    LocationUpdate,
    Material,
    MaterialCreate,
    MaterialDetail,
    MaterialSearchItem,
    StockRequest,
    StockRequestCreate,
    StockRequestStatus,
    StockRequestType,
    Transaction,
    TransactionType,
)
from app.utils.categories import category_descendant_ids, derive_major_sub_names

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

    def _remove_cached_record(self, table_id: str, record_id: str) -> None:
        if not table_id or not record_id:
            return
        cache_key = (self.settings.bitable_app_token, table_id)
        cached = _TABLE_CACHE.get(cache_key)
        if not cached:
            return
        cached_at, records = cached
        _TABLE_CACHE[cache_key] = (
            cached_at,
            [item for item in records if item.get("record_id") != record_id],
        )

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
            s.bitable_table_requests,
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
            category = categories.get(cat_id)
            major_category = field_text(fields.get(s.bitable_f_material_major_category))
            sub_category = field_text(fields.get(s.bitable_f_material_sub_category))
            loc_id = field_link_id(fields.get(s.bitable_f_material_default_location)) or ""
            min_stock_value = field_number(fields.get(s.bitable_f_material_min_stock))
            result[rid] = Material(
                id=rid,
                code=field_text(fields.get(s.bitable_f_material_code)) or rid,
                name=field_text(fields.get(s.bitable_f_material_name)) or "未命名物料",
                category_id=cat_id,
                category_name=category.name if category else None,
                major_category=major_category or (category.major_name if category else None),
                sub_category=sub_category or (category.sub_name if category else None),
                unit=field_text(fields.get(s.bitable_f_material_unit)) or "个",
                spec=field_text(fields.get(s.bitable_f_material_spec)),
                barcode=field_text(fields.get(s.bitable_f_material_barcode)),
                default_location_id=loc_id or None,
                supplier=field_text(fields.get(s.bitable_f_material_supplier)),
                min_stock=min_stock_value if min_stock_value > 0 else 5,
            )
            if loc_id and loc_id in locations and not result[rid].default_location_id:
                pass
        self._materials_cache = result
        return result

    async def _load_categories(self) -> dict[str, Category]:
        s = self.settings
        if not s.bitable_table_categories:
            return {}
        records = await self._list_all(s.bitable_table_categories)
        result: dict[str, Category] = {}
        for rec in records:
            fields = rec.get("fields", {})
            rid = rec["record_id"]
            major = field_text(fields.get(s.bitable_f_category_major))
            sub = field_text(fields.get(s.bitable_f_category_sub))
            legacy_name = field_text(fields.get(s.bitable_f_category_name))
            name = sub or legacy_name or major or rid
            result[rid] = Category(
                id=rid,
                name=name,
                major_name=major or legacy_name,
                sub_name=sub or legacy_name,
                default_location_type=field_text(fields.get(s.bitable_f_category_default_location_type)),
                examples=field_text(fields.get(s.bitable_f_category_examples)),
            )
        return result

    async def list_categories(self) -> list[Category]:
        categories = await self._load_categories()
        return list(categories.values())

    async def create_category(self, payload: CategoryCreate) -> Category:
        raise RuntimeError("category_crud_requires_mock_or_bitable_parent_field")

    async def delete_category(self, category_id: str) -> None:
        raise RuntimeError("category_crud_requires_mock_or_bitable_parent_field")

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
        search_by: str,
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
            def match(material: Material) -> bool:
                if search_by == "name":
                    return keyword in material.name.lower()
                if search_by == "code":
                    return keyword in material.code.lower() or (
                        material.barcode is not None and keyword in material.barcode.lower()
                    )
                if search_by == "category":
                    return (
                        (material.category_name is not None and keyword in material.category_name.lower())
                        or (material.major_category is not None and keyword in material.major_category.lower())
                        or (material.sub_category is not None and keyword in material.sub_category.lower())
                    )
                return (
                    keyword in material.name.lower()
                    or keyword in material.code.lower()
                    or (material.spec is not None and keyword in material.spec.lower())
                    or (material.supplier is not None and keyword in material.supplier.lower())
                    or (material.barcode is not None and keyword in material.barcode.lower())
                    or (material.category_name is not None and keyword in material.category_name.lower())
                    or (material.major_category is not None and keyword in material.major_category.lower())
                    or (material.sub_category is not None and keyword in material.sub_category.lower())
                )

            materials = [m for m in materials if match(m)]
        if category:
            categories = await self._load_categories()
            if category in categories:
                allowed_ids = category_descendant_ids(categories, category)
                materials = [m for m in materials if m.category_id in allowed_ids]
            else:
                materials = [
                    m
                    for m in materials
                    if m.category_id == category
                    or m.category_name == category
                    or m.major_category == category
                    or m.sub_category == category
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
        category = categories.get(payload.category_id)
        if not category:
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
            s.bitable_f_material_major_category: (
                payload.major_category or category.major_name or category.name
            ),
            s.bitable_f_material_sub_category: (
                payload.sub_category or category.sub_name or category.name
            ),
            s.bitable_f_material_unit: payload.unit.strip() or "个",
            s.bitable_f_material_min_stock: payload.min_stock,
        }
        if payload.spec:
            fields[s.bitable_f_material_spec] = payload.spec.strip()
        if payload.barcode:
            fields[s.bitable_f_material_barcode] = payload.barcode.strip()
        if payload.default_location_id:
            fields[s.bitable_f_material_default_location] = write_link(payload.default_location_id)
        if payload.supplier:
            fields[s.bitable_f_material_supplier] = payload.supplier.strip()

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
            category_name=category.name,
            major_category=payload.major_category or category.major_name or category.name,
            sub_category=payload.sub_category or category.sub_name or category.name,
            unit=payload.unit.strip() or "个",
            spec=payload.spec.strip() if payload.spec else None,
            barcode=payload.barcode.strip() if payload.barcode else None,
            default_location_id=payload.default_location_id,
            supplier=payload.supplier.strip() if payload.supplier else None,
            min_stock=payload.min_stock,
        )

    async def update_material_supplier(self, material_id: str, supplier: str | None) -> Material:
        material = await self.get_material(material_id)
        if not material:
            raise ValueError("material_not_found")
        supplier_value = supplier.strip() if supplier else None
        s = self.settings
        fields = {s.bitable_f_material_supplier: supplier_value or ""}
        rec = await self.client.update_record(s.bitable_table_materials, material_id, fields)
        self._materials_cache = None
        self._upsert_cached_record(
            s.bitable_table_materials,
            rec if rec.get("fields") else self._cached_record(material_id, fields),
        )
        return material.model_copy(update={"supplier": supplier_value})

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
                or (m.spec and keyword in m.spec.lower())
                or (m.supplier and keyword in m.supplier.lower())
                or (m.barcode and keyword in m.barcode.lower())
                or (m.category_name and keyword in (m.category_name or "").lower())
                or (m.major_category and keyword in m.major_category.lower())
                or (m.sub_category and keyword in m.sub_category.lower())
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

    async def create_location(self, payload: LocationCreate) -> Location:
        locations = await self._load_locations()
        code = payload.code.strip()
        name = payload.name.strip()
        loc_type = payload.type.strip() or "货柜"
        if any(loc.code == code for loc in locations.values()):
            raise ValueError("location_code_exists")

        s = self.settings
        fields = {
            s.bitable_f_location_code: code,
            s.bitable_f_location_name: name,
            s.bitable_f_location_type: loc_type,
        }
        rec = await self.client.create_record(s.bitable_table_locations, fields)
        rid = rec.get("record_id", "")
        self._locations_cache = None
        self._upsert_cached_record(
            s.bitable_table_locations,
            rec if rec.get("fields") else self._cached_record(rid, fields),
        )
        return Location(id=rid, code=code, name=name, type=loc_type)

    async def update_location(self, location_id: str, payload: LocationUpdate) -> Location:
        locations = await self._load_locations()
        current = locations.get(location_id)
        if not current:
            raise ValueError("location_not_found")

        code = payload.code.strip() if payload.code is not None else current.code
        name = payload.name.strip() if payload.name is not None else current.name
        loc_type = payload.type.strip() if payload.type is not None else current.type
        if any(loc.id != location_id and loc.code == code for loc in locations.values()):
            raise ValueError("location_code_exists")

        s = self.settings
        fields = {
            s.bitable_f_location_code: code,
            s.bitable_f_location_name: name,
            s.bitable_f_location_type: loc_type or "货柜",
        }
        rec = await self.client.update_record(s.bitable_table_locations, location_id, fields)
        self._locations_cache = None
        self._upsert_cached_record(
            s.bitable_table_locations,
            rec if rec.get("fields") else self._cached_record(location_id, fields),
        )
        return Location(id=location_id, code=code, name=name, type=loc_type or "货柜")

    async def delete_location(self, location_id: str) -> None:
        locations = await self._load_locations()
        if location_id not in locations:
            raise ValueError("location_not_found")

        inventory = await self._load_inventory_map()
        occupied = sum(qty for (_, lid), qty in inventory.items() if lid == location_id and qty > 0)
        if occupied > 0:
            raise ValueError(f"location_not_empty:{occupied}")

        s = self.settings
        await self.client.delete_record(s.bitable_table_locations, location_id)
        self._locations_cache = None
        self._remove_cached_record(s.bitable_table_locations, location_id)

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

    async def list_transactions(
        self,
        *,
        operator: str | None = None,
        keyword: str | None = None,
        start_at: datetime | None = None,
        end_at: datetime | None = None,
        limit: int = 100,
    ) -> list[Transaction]:
        s = self.settings
        materials = await self._load_materials()
        locations = await self._load_locations()
        records = await self._list_all(s.bitable_table_transactions)
        txs: list[Transaction] = []
        for rec in records:
            fields = rec.get("fields", {})
            mid = field_link_id(fields.get(s.bitable_f_tx_material)) or ""
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
            tx = Transaction(
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
            txs.append(tx)

        if operator:
            txs = [tx for tx in txs if tx.operator == operator]
        if start_at:
            txs = [tx for tx in txs if tx.created_at >= start_at]
        if end_at:
            txs = [tx for tx in txs if tx.created_at <= end_at]
        if keyword:
            text = keyword.lower()
            txs = [
                tx
                for tx in txs
                if text in (tx.material_name or "").lower()
                or text in (tx.location_name or "").lower()
                or text in tx.operator.lower()
                or text in (tx.remark or "").lower()
            ]
        txs.sort(key=lambda t: t.created_at, reverse=True)
        return txs[:limit]

    def _require_requests_table(self) -> None:
        if not self.settings.bitable_table_requests:
            raise RuntimeError("Bitable 申请表未配置，请设置 BITABLE_TABLE_REQUESTS")

    @staticmethod
    def _parse_request_type(value: Any) -> StockRequestType:
        raw = (field_text(value) or "").strip().lower()
        if raw in {"in", "入库", "inbound"}:
            return StockRequestType.INBOUND
        if raw in {"out", "出库", "outbound"}:
            return StockRequestType.OUTBOUND
        return StockRequestType.OUTBOUND

    @staticmethod
    def _parse_request_status(value: Any) -> StockRequestStatus:
        raw = (field_text(value) or "").strip().lower()
        if raw in {"approved", "approve", "已通过", "通过"}:
            return StockRequestStatus.APPROVED
        if raw in {"rejected", "reject", "已拒绝", "拒绝"}:
            return StockRequestStatus.REJECTED
        return StockRequestStatus.PENDING

    @staticmethod
    def _parse_bitable_datetime(value: Any) -> datetime | None:
        if isinstance(value, (int, float)):
            return datetime.fromtimestamp(value / 1000, tz=timezone.utc)
        if isinstance(value, str) and value.strip():
            raw = value.strip().replace("Z", "+00:00")
            try:
                parsed = datetime.fromisoformat(raw)
            except ValueError:
                return None
            if parsed.tzinfo is None:
                return parsed.replace(tzinfo=timezone.utc)
            return parsed
        return None

    def _parse_request(self, rec: dict[str, Any], materials: dict[str, Material], locations: dict[str, Location]) -> StockRequest:
        s = self.settings
        fields = rec.get("fields", {})
        mid = field_link_id(fields.get(s.bitable_f_request_material)) or ""
        lid = field_link_id(fields.get(s.bitable_f_request_location)) or ""
        req_type = self._parse_request_type(fields.get(s.bitable_f_request_type))
        status = self._parse_request_status(fields.get(s.bitable_f_request_status))
        created_at = self._parse_bitable_datetime(fields.get(s.bitable_f_request_created)) or datetime.now(timezone.utc)
        reviewed_at = self._parse_bitable_datetime(fields.get(s.bitable_f_request_reviewed))
        material = materials.get(mid)
        location = locations.get(lid)
        requester_name = field_user_name(fields.get(s.bitable_f_request_requester)) or "未知"
        requester_open_id = field_user_id(fields.get(s.bitable_f_request_requester)) or ""
        approver_open_id = field_user_id(fields.get(s.bitable_f_request_approver))
        approver_name = field_user_name(fields.get(s.bitable_f_request_approver))
        return StockRequest(
            id=rec["record_id"],
            type=req_type,
            status=status,
            material_id=mid,
            material_name=material.name if material else None,
            location_id=lid,
            location_name=location.name if location else lid,
            quantity=field_number(fields.get(s.bitable_f_request_quantity)),
            requester_open_id=requester_open_id,
            requester_name=requester_name,
            approver_open_id=approver_open_id,
            approver_name=approver_name,
            remark=field_text(fields.get(s.bitable_f_request_remark)),
            reject_reason=field_text(fields.get(s.bitable_f_request_reject_reason)),
            transaction_id=field_text(fields.get(s.bitable_f_request_transaction)),
            created_at=created_at,
            reviewed_at=reviewed_at,
        )

    async def create_request(
        self,
        payload: StockRequestCreate,
        requester_open_id: str,
        requester_name: str,
    ) -> StockRequest:
        self._require_requests_table()
        material = await self.get_material(payload.material_id)
        if not material:
            raise ValueError("material_not_found")
        locations = await self._load_locations()
        location = locations.get(payload.location_id)
        if not location:
            raise ValueError("location_not_found")

        s = self.settings
        fields: dict[str, Any] = {
            s.bitable_f_request_type: payload.type.value,
            s.bitable_f_request_status: StockRequestStatus.PENDING.value,
            s.bitable_f_request_material: write_link(payload.material_id),
            s.bitable_f_request_location: write_link(payload.location_id),
            s.bitable_f_request_quantity: payload.qty,
            s.bitable_f_request_remark: payload.note,
        }
        if requester_open_id:
            fields[s.bitable_f_request_requester] = write_user(requester_open_id)

        rec = await self.client.create_record(s.bitable_table_requests, fields)
        self._upsert_cached_record(
            s.bitable_table_requests,
            rec if rec.get("fields") else self._cached_record(rec.get("record_id", ""), fields),
        )
        return StockRequest(
            id=rec.get("record_id", "req_new"),
            type=payload.type,
            status=StockRequestStatus.PENDING,
            material_id=payload.material_id,
            material_name=material.name,
            location_id=payload.location_id,
            location_name=location.name,
            quantity=payload.qty,
            requester_open_id=requester_open_id,
            requester_name=requester_name,
            remark=payload.note,
            created_at=datetime.now(timezone.utc),
        )

    async def list_requests(
        self,
        *,
        requester_open_id: str | None = None,
        requester_name: str | None = None,
        status: StockRequestStatus | None = None,
        keyword: str | None = None,
        limit: int = 100,
    ) -> list[StockRequest]:
        self._require_requests_table()
        materials = await self._load_materials()
        locations = await self._load_locations()
        records = await self._list_all(self.settings.bitable_table_requests)
        items = [self._parse_request(rec, materials, locations) for rec in records]
        if requester_name:
            items = [item for item in items if item.requester_name == requester_name]
        if requester_open_id:
            items = [
                item for item in items if not item.requester_open_id or item.requester_open_id == requester_open_id
            ]
        if status:
            items = [item for item in items if item.status == status]
        if keyword:
            text = keyword.lower()
            items = [
                item
                for item in items
                if text in (item.material_name or "").lower()
                or text in (item.location_name or "").lower()
                or text in item.requester_name.lower()
                or text in (item.remark or "").lower()
            ]
        items.sort(key=lambda item: item.created_at, reverse=True)
        return items[:limit]

    async def approve_request(
        self,
        request_id: str,
        approver_open_id: str,
        approver_name: str,
    ) -> StockRequest:
        self._require_requests_table()
        materials = await self._load_materials()
        locations = await self._load_locations()
        records = await self._list_all(self.settings.bitable_table_requests)
        rec = next((item for item in records if item.get("record_id") == request_id), None)
        if not rec:
            raise ValueError("request_not_found")
        req = self._parse_request(rec, materials, locations)
        if req.status != StockRequestStatus.PENDING:
            raise ValueError("request_already_reviewed")

        approval_note = f"{req.remark or ''}；审批人：{approver_name}".strip("；")
        requester_open_id = req.requester_open_id or ""
        if req.type == StockRequestType.INBOUND:
            tx = await self.apply_inbound(
                req.material_id,
                req.location_id,
                req.quantity,
                requester_open_id,
                req.requester_name,
                approval_note,
            )
        else:
            tx = await self.apply_outbound(
                req.material_id,
                req.location_id,
                req.quantity,
                requester_open_id,
                req.requester_name,
                approval_note,
            )

        reviewed_at = int(datetime.now(timezone.utc).timestamp() * 1000)
        s = self.settings
        fields: dict[str, Any] = {
            s.bitable_f_request_status: StockRequestStatus.APPROVED.value,
            s.bitable_f_request_transaction: tx.id,
            s.bitable_f_request_reviewed: reviewed_at,
        }
        if approver_open_id:
            fields[s.bitable_f_request_approver] = write_user(approver_open_id)
        updated_rec = await self.client.update_record(s.bitable_table_requests, request_id, fields)
        self._upsert_cached_record(
            s.bitable_table_requests,
            updated_rec if updated_rec.get("fields") else self._cached_record(request_id, fields),
        )
        return req.model_copy(
            update={
                "status": StockRequestStatus.APPROVED,
                "approver_open_id": approver_open_id,
                "approver_name": approver_name,
                "transaction_id": tx.id,
                "reviewed_at": datetime.fromtimestamp(reviewed_at / 1000, tz=timezone.utc),
            }
        )

    async def reject_request(
        self,
        request_id: str,
        approver_open_id: str,
        approver_name: str,
        reason: str,
    ) -> StockRequest:
        self._require_requests_table()
        materials = await self._load_materials()
        locations = await self._load_locations()
        records = await self._list_all(self.settings.bitable_table_requests)
        rec = next((item for item in records if item.get("record_id") == request_id), None)
        if not rec:
            raise ValueError("request_not_found")
        req = self._parse_request(rec, materials, locations)
        if req.status != StockRequestStatus.PENDING:
            raise ValueError("request_already_reviewed")

        reviewed_at = int(datetime.now(timezone.utc).timestamp() * 1000)
        s = self.settings
        fields: dict[str, Any] = {
            s.bitable_f_request_status: StockRequestStatus.REJECTED.value,
            s.bitable_f_request_reject_reason: reason,
            s.bitable_f_request_reviewed: reviewed_at,
        }
        if approver_open_id:
            fields[s.bitable_f_request_approver] = write_user(approver_open_id)
        updated_rec = await self.client.update_record(s.bitable_table_requests, request_id, fields)
        self._upsert_cached_record(
            s.bitable_table_requests,
            updated_rec if updated_rec.get("fields") else self._cached_record(request_id, fields),
        )
        return req.model_copy(
            update={
                "status": StockRequestStatus.REJECTED,
                "approver_open_id": approver_open_id,
                "approver_name": approver_name,
                "reject_reason": reason,
                "reviewed_at": datetime.fromtimestamp(reviewed_at / 1000, tz=timezone.utc),
            }
        )

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
