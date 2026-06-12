from datetime import datetime, timezone
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
    InventoryItem,
    Location,
    Material,
    MaterialDetail,
    Transaction,
    TransactionType,
)


class BitableRepository:
    """Bitable real 模式：读写五表（字段名可通过 Settings 配置）。"""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.client = BYTableClient(settings)
        self._materials_cache: dict[str, Material] | None = None
        self._locations_cache: dict[str, Location] | None = None

    async def _list_all(self, table_id: str) -> list[dict[str, Any]]:
        return await self.client.list_records(table_id)

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
        page: int,
        size: int,
    ) -> tuple[list[Material], int]:
        materials = list((await self._load_materials()).values())
        inventory = await self._load_inventory_map()

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

        total = len(materials)
        start = (page - 1) * size
        return materials[start : start + size], total

    async def get_material(self, material_id: str) -> Material | None:
        return (await self._load_materials()).get(material_id)

    async def list_material_catalog(
        self,
        q: str | None = None,
        stock_only: bool = False,
    ) -> list[MaterialDetail]:
        """一次拉取物料 + 库存（出库选料、入库表单共用）。"""
        materials = list((await self._load_materials()).values())
        inv_map = await self._load_inventory_map()
        inv_records = await self._load_inventory_records()
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

    async def _load_inventory_map(self) -> dict[tuple[str, str], int]:
        s = self.settings
        records = await self._list_all(s.bitable_table_inventory)
        result: dict[tuple[str, str], int] = {}
        for rec in records:
            fields = rec.get("fields", {})
            mid = field_link_id(fields.get(s.bitable_f_inventory_material))
            lid = field_link_id(fields.get(s.bitable_f_inventory_location))
            if mid and lid:
                result[(mid, lid)] = field_number(fields.get(s.bitable_f_inventory_quantity))
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
        inv_map = await self._load_inventory_map()
        inv_records = await self._load_inventory_records()
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
        materials = await self._load_materials()
        all_items: list[InventoryItem] = []
        for mid in materials:
            for item in await self.get_inventory_for_material(mid):
                if material_id and item.material_id != material_id:
                    continue
                if location_id and item.location_id != location_id:
                    continue
                all_items.append(item)
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
            tx_enum = TransactionType.INBOUND if normalized == "入库" else TransactionType.OUTBOUND
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

        if key in inv_records:
            await self.client.update_record(
                s.bitable_table_inventory,
                inv_records[key]["record_id"],
                {
                    s.bitable_f_inventory_quantity: new_qty,
                    s.bitable_f_inventory_updated: int(datetime.now(timezone.utc).timestamp() * 1000),
                },
            )
        else:
            await self.client.create_record(
                s.bitable_table_inventory,
                {
                    s.bitable_f_inventory_material: write_link(material_id),
                    s.bitable_f_inventory_location: write_link(location_id),
                    s.bitable_f_inventory_quantity: new_qty,
                    s.bitable_f_inventory_updated: int(datetime.now(timezone.utc).timestamp() * 1000),
                },
            )

        tx_rec = await self.client.create_record(
            s.bitable_table_transactions,
            self._build_tx_fields(
                s.bitable_v_tx_inbound,
                material_id,
                location_id,
                qty,
                operator_open_id,
                remark,
            ),
        )
        self._invalidate_cache()
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

        await self.client.update_record(
            s.bitable_table_inventory,
            inv_records[key]["record_id"],
            {
                s.bitable_f_inventory_quantity: current - qty,
                s.bitable_f_inventory_updated: int(datetime.now(timezone.utc).timestamp() * 1000),
            },
        )
        tx_rec = await self.client.create_record(
            s.bitable_table_transactions,
            self._build_tx_fields(
                s.bitable_v_tx_outbound,
                material_id,
                location_id,
                qty,
                operator_open_id,
                remark,
            ),
        )
        self._invalidate_cache()
        materials = await self._load_materials()
        locations = await self._load_locations()
        return Transaction(
            id=tx_rec.get("record_id", "tx_new"),
            type=TransactionType.OUTBOUND,
            material_id=material_id,
            material_name=materials[material_id].name,
            location_id=location_id,
            location_name=locations.get(location_id, Location(id=location_id, code="", name=location_id)).name,
            quantity=qty,
            operator=operator_name,
            remark=remark,
            created_at=datetime.now(timezone.utc),
        )

    def _invalidate_cache(self) -> None:
        self._materials_cache = None
        self._locations_cache = None

    async def snapshot(self) -> dict[str, int]:
        return {
            "materials": len(await self._load_materials()),
            "locations": len(await self._load_locations()),
            "inventory": len(await self._load_inventory_map()),
        }
