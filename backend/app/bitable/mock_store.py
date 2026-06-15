from datetime import datetime, timezone
from typing import Any

from app.models import (
    Category,
    InventoryItem,
    Location,
    Material,
    MaterialCreate,
    MaterialDetail,
    Transaction,
    TransactionType,
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class MockStore:
    """内存数据存储，BITABLE_MODE=mock 时使用。"""

    def __init__(self) -> None:
        self.categories: dict[str, Category] = {}
        self.locations: dict[str, Location] = {}
        self.materials: dict[str, Material] = {}
        self.inventory: dict[tuple[str, str], InventoryItem] = {}
        self.transactions: dict[str, Transaction] = {}
        self._seed()

    def _seed(self) -> None:
        self.categories = {
            "cat_motor": Category(id="cat_motor", name="电机模组"),
            "cat_sensor": Category(id="cat_sensor", name="感知设备"),
        }
        self.locations = {
            "loc_01": Location(id="loc_01", code="A-柜-01", name="A区货柜-01", type="货柜"),
            "loc_staging": Location(
                id="loc_staging", code="STAGE-01", name="快递暂存区", type="快递暂存"
            ),
        }
        self.materials = {
            "mat_001": Material(
                id="mat_001",
                code="M001",
                name="大喵电机",
                category_id="cat_motor",
                category_name="电机模组",
                unit="个",
                spec="标准版",
                barcode="6900001",
                default_location_id="loc_01",
            ),
            "mat_002": Material(
                id="mat_002",
                code="M002",
                name="激光雷达",
                category_id="cat_sensor",
                category_name="感知设备",
                unit="个",
                spec="16线",
                barcode="6900002",
                default_location_id="loc_01",
            ),
        }
        now = _utcnow()
        self.inventory = {
            ("mat_001", "loc_01"): InventoryItem(
                material_id="mat_001",
                location_id="loc_01",
                location_name="A区货柜-01",
                quantity=3,
                last_updated=now,
            ),
            ("mat_002", "loc_01"): InventoryItem(
                material_id="mat_002",
                location_id="loc_01",
                location_name="A区货柜-01",
                quantity=5,
                last_updated=now,
            ),
        }

    def search_materials(
        self,
        q: str | None = None,
        category: str | None = None,
        location: str | None = None,
        page: int = 1,
        size: int = 20,
    ) -> tuple[list[Material], int]:
        items = list(self.materials.values())
        if q:
            keyword = q.lower()
            items = [
                m
                for m in items
                if keyword in m.name.lower()
                or keyword in m.code.lower()
                or (m.barcode and keyword in m.barcode.lower())
            ]
        if category:
            items = [m for m in items if m.category_id == category or m.category_name == category]
        if location:
            mat_ids = {
                mid for (mid, lid), inv in self.inventory.items() if lid == location and inv.quantity > 0
            }
            items = [m for m in items if m.id in mat_ids]
        total = len(items)
        start = (page - 1) * size
        return items[start : start + size], total

    def get_material(self, material_id: str) -> Material | None:
        return self.materials.get(material_id)

    def list_categories(self) -> list[Category]:
        return list(self.categories.values())

    def create_material(self, payload: MaterialCreate) -> Material:
        if payload.category_id not in self.categories:
            raise ValueError("category_not_found")
        if payload.default_location_id and payload.default_location_id not in self.locations:
            raise ValueError("location_not_found")

        material_id = f"mat_{len(self.materials) + 1:03d}"
        category = self.categories[payload.category_id]
        material = Material(
            id=material_id,
            code=payload.code or f"M{len(self.materials) + 1:03d}",
            name=payload.name.strip(),
            category_id=payload.category_id,
            category_name=category.name,
            unit=payload.unit.strip() or "个",
            spec=payload.spec.strip() if payload.spec else None,
            barcode=payload.barcode.strip() if payload.barcode else None,
            default_location_id=payload.default_location_id,
        )
        self.materials[material_id] = material
        return material

    def list_material_catalog(
        self,
        q: str | None = None,
        stock_only: bool = False,
    ) -> list[MaterialDetail]:
        items = list(self.materials.values())
        if q:
            keyword = q.lower()
            items = [
                m
                for m in items
                if keyword in m.name.lower()
                or keyword in m.code.lower()
                or (m.barcode and keyword in m.barcode.lower())
                or (m.category_name and keyword in (m.category_name or "").lower())
            ]
        catalog: list[MaterialDetail] = []
        for m in sorted(items, key=lambda x: x.name):
            inventory = self.get_inventory_for_material(m.id)
            total = sum(i.quantity for i in inventory)
            if stock_only and total <= 0:
                continue
            catalog.append(
                MaterialDetail(material=m, inventory=inventory, total_quantity=total)
            )
        return catalog

    def get_inventory_for_material(self, material_id: str) -> list[InventoryItem]:
        return [
            inv
            for (mid, _), inv in self.inventory.items()
            if mid == material_id and inv.quantity > 0
        ]

    def list_inventory(
        self, material_id: str | None = None, location_id: str | None = None
    ) -> list[InventoryItem]:
        items = list(self.inventory.values())
        if material_id:
            items = [i for i in items if i.material_id == material_id]
        if location_id:
            items = [i for i in items if i.location_id == location_id]
        return items

    def get_transactions(self, material_id: str, limit: int = 20) -> list[Transaction]:
        txs = [t for t in self.transactions.values() if t.material_id == material_id]
        txs.sort(key=lambda t: t.created_at, reverse=True)
        return txs[:limit]

    def apply_inbound(
        self,
        material_id: str,
        location_id: str,
        qty: int,
        operator: str,
        remark: str | None,
    ) -> Transaction:
        if material_id not in self.materials:
            raise ValueError("material_not_found")
        if location_id not in self.locations:
            raise ValueError("location_not_found")
        key = (material_id, location_id)
        loc = self.locations[location_id]
        now = _utcnow()
        if key in self.inventory:
            item = self.inventory[key]
            item.quantity += qty
            item.last_updated = now
        else:
            self.inventory[key] = InventoryItem(
                material_id=material_id,
                location_id=location_id,
                location_name=loc.name,
                quantity=qty,
                last_updated=now,
            )
        tx_id = f"tx_{len(self.transactions) + 1:04d}"
        material = self.materials[material_id]
        tx = Transaction(
            id=tx_id,
            type=TransactionType.INBOUND,
            material_id=material_id,
            material_name=material.name,
            location_id=location_id,
            location_name=loc.name,
            quantity=qty,
            operator=operator,
            remark=remark,
            created_at=now,
        )
        self.transactions[tx_id] = tx
        return tx

    def apply_outbound(
        self,
        material_id: str,
        location_id: str,
        qty: int,
        operator: str,
        remark: str | None,
    ) -> Transaction:
        if material_id not in self.materials:
            raise ValueError("material_not_found")
        key = (material_id, location_id)
        if key not in self.inventory or self.inventory[key].quantity < qty:
            available = self.inventory[key].quantity if key in self.inventory else 0
            raise ValueError(f"insufficient_stock:{available}")
        item = self.inventory[key]
        item.quantity -= qty
        item.last_updated = _utcnow()
        loc = self.locations.get(location_id)
        tx_id = f"tx_{len(self.transactions) + 1:04d}"
        material = self.materials[material_id]
        tx = Transaction(
            id=tx_id,
            type=TransactionType.OUTBOUND,
            material_id=material_id,
            material_name=material.name,
            location_id=location_id,
            location_name=loc.name if loc else None,
            quantity=qty,
            operator=operator,
            remark=remark,
            created_at=_utcnow(),
        )
        self.transactions[tx_id] = tx
        return tx

    def snapshot(self) -> dict[str, Any]:
        return {
            "categories": len(self.categories),
            "locations": len(self.locations),
            "materials": len(self.materials),
            "inventory": len(self.inventory),
            "transactions": len(self.transactions),
        }


_store: MockStore | None = None


def get_mock_store() -> MockStore:
    global _store
    if _store is None:
        _store = MockStore()
    return _store
