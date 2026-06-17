from datetime import datetime, timezone
from typing import Any

from app.models import (
    Category,
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
        self.requests: dict[str, StockRequest] = {}
        self._seed()

    def _seed(self) -> None:
        self.categories = {
            "cat_motor_dm": Category(
                id="cat_motor_dm",
                name="达妙电机",
                major_name="电机模组",
                sub_name="达妙电机",
                default_location_type="货柜",
                examples="同川电机、达妙电机、鸣志电机、驱动器",
            ),
            "cat_sensor_lidar": Category(
                id="cat_sensor_lidar",
                name="激光雷达",
                major_name="感知设备",
                sub_name="激光雷达",
                default_location_type="货柜",
                examples="激光雷达、2D相机、3D相机",
            ),
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
                category_id="cat_motor_dm",
                category_name="达妙电机",
                major_category="电机模组",
                sub_category="达妙电机",
                unit="个",
                spec="标准版",
                barcode="6900001",
                default_location_id="loc_01",
                supplier="达妙科技",
                min_stock=5,
            ),
            "mat_002": Material(
                id="mat_002",
                code="M002",
                name="激光雷达",
                category_id="cat_sensor_lidar",
                category_name="激光雷达",
                major_category="感知设备",
                sub_category="激光雷达",
                unit="个",
                spec="16线",
                barcode="6900002",
                default_location_id="loc_01",
                supplier="雷达供应商A",
                min_stock=5,
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
        self.transactions = {}
        self.requests = {}

    def search_materials(
        self,
        q: str | None = None,
        search_by: str = "all",
        category: str | None = None,
        location: str | None = None,
        stock_only: bool = False,
        page: int = 1,
        size: int = 20,
    ) -> tuple[list[MaterialSearchItem], int]:
        items = list(self.materials.values())
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
                    or (material.supplier is not None and keyword in material.supplier.lower())
                    or (material.barcode is not None and keyword in material.barcode.lower())
                    or (material.category_name is not None and keyword in material.category_name.lower())
                    or (material.major_category is not None and keyword in material.major_category.lower())
                    or (material.sub_category is not None and keyword in material.sub_category.lower())
                )

            items = [m for m in items if match(m)]
        if category:
            items = [
                m
                for m in items
                if m.category_id == category
                or m.category_name == category
                or m.major_category == category
                or m.sub_category == category
            ]
        if location:
            mat_ids = {
                mid for (mid, lid), inv in self.inventory.items() if lid == location and inv.quantity > 0
            }
            items = [m for m in items if m.id in mat_ids]
        if stock_only:
            mat_ids = {
                mid for (mid, _), inv in self.inventory.items() if inv.quantity > 0
            }
            items = [m for m in items if m.id in mat_ids]
        total = len(items)
        start = (page - 1) * size
        return [self._to_search_item(m) for m in items[start : start + size]], total

    def _to_search_item(self, material: Material) -> MaterialSearchItem:
        inventory = self.get_inventory_for_material(material.id)
        total = sum(i.quantity for i in inventory)
        summary = " · ".join(f"{i.location_name or i.location_id} {i.quantity}" for i in inventory[:3])
        return MaterialSearchItem(
            **material.model_dump(),
            total_quantity=total,
            locations_summary=summary or None,
        )

    def get_material(self, material_id: str) -> Material | None:
        return self.materials.get(material_id)

    def list_categories(self) -> list[Category]:
        return list(self.categories.values())

    def create_location(self, payload: LocationCreate) -> Location:
        code = payload.code.strip()
        if any(loc.code == code for loc in self.locations.values()):
            raise ValueError("location_code_exists")
        location_id = f"loc_{len(self.locations) + 1:03d}"
        location = Location(
            id=location_id,
            code=code,
            name=payload.name.strip(),
            type=payload.type.strip() or "货柜",
        )
        self.locations[location_id] = location
        return location

    def update_location(self, location_id: str, payload: LocationUpdate) -> Location:
        if location_id not in self.locations:
            raise ValueError("location_not_found")
        current = self.locations[location_id]
        code = payload.code.strip() if payload.code is not None else current.code
        if any(loc.id != location_id and loc.code == code for loc in self.locations.values()):
            raise ValueError("location_code_exists")
        updated = Location(
            id=location_id,
            code=code,
            name=payload.name.strip() if payload.name is not None else current.name,
            type=payload.type.strip() if payload.type is not None else current.type,
        )
        self.locations[location_id] = updated
        for item in self.inventory.values():
            if item.location_id == location_id:
                item.location_name = updated.name
        return updated

    def delete_location(self, location_id: str) -> None:
        if location_id not in self.locations:
            raise ValueError("location_not_found")
        occupied = sum(
            item.quantity
            for item in self.inventory.values()
            if item.location_id == location_id and item.quantity > 0
        )
        if occupied > 0:
            raise ValueError(f"location_not_empty:{occupied}")
        del self.locations[location_id]
        self.inventory = {
            key: item for key, item in self.inventory.items() if item.location_id != location_id
        }

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
            major_category=payload.major_category or category.major_name or category.name,
            sub_category=payload.sub_category or category.sub_name or category.name,
            unit=payload.unit.strip() or "个",
            spec=payload.spec.strip() if payload.spec else None,
            barcode=payload.barcode.strip() if payload.barcode else None,
            default_location_id=payload.default_location_id,
            supplier=payload.supplier.strip() if payload.supplier else None,
            min_stock=payload.min_stock,
        )
        self.materials[material_id] = material
        return material

    def update_material_supplier(self, material_id: str, supplier: str | None) -> Material:
        material = self.materials.get(material_id)
        if not material:
            raise ValueError("material_not_found")
        updated = material.model_copy(update={"supplier": supplier.strip() if supplier else None})
        self.materials[material_id] = updated
        return updated

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
                or (m.supplier and keyword in m.supplier.lower())
                or (m.barcode and keyword in m.barcode.lower())
                or (m.category_name and keyword in (m.category_name or "").lower())
                or (m.major_category and keyword in m.major_category.lower())
                or (m.sub_category and keyword in m.sub_category.lower())
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

    def list_transactions(
        self,
        *,
        operator: str | None = None,
        keyword: str | None = None,
        start_at: datetime | None = None,
        end_at: datetime | None = None,
        limit: int = 100,
    ) -> list[Transaction]:
        txs = list(self.transactions.values())
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

    def create_request(
        self,
        payload: StockRequestCreate,
        requester_open_id: str,
        requester_name: str,
    ) -> StockRequest:
        if payload.material_id not in self.materials:
            raise ValueError("material_not_found")
        if payload.location_id not in self.locations:
            raise ValueError("location_not_found")
        material = self.materials[payload.material_id]
        location = self.locations[payload.location_id]
        request_id = f"req_{len(self.requests) + 1:04d}"
        req = StockRequest(
            id=request_id,
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
            created_at=_utcnow(),
        )
        self.requests[request_id] = req
        return req

    def list_requests(
        self,
        *,
        requester_open_id: str | None = None,
        status: StockRequestStatus | None = None,
        keyword: str | None = None,
        limit: int = 100,
    ) -> list[StockRequest]:
        items = list(self.requests.values())
        if requester_open_id:
            items = [item for item in items if item.requester_open_id == requester_open_id]
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

    def approve_request(
        self,
        request_id: str,
        approver_open_id: str,
        approver_name: str,
    ) -> StockRequest:
        req = self.requests.get(request_id)
        if not req:
            raise ValueError("request_not_found")
        if req.status != StockRequestStatus.PENDING:
            raise ValueError("request_already_reviewed")

        approval_note = f"{req.remark or ''}；审批人：{approver_name}".strip("；")
        if req.type == StockRequestType.INBOUND:
            tx = self.apply_inbound(
                req.material_id,
                req.location_id,
                req.quantity,
                req.requester_name,
                approval_note,
            )
        else:
            tx = self.apply_outbound(
                req.material_id,
                req.location_id,
                req.quantity,
                req.requester_name,
                approval_note,
            )

        reviewed_at = _utcnow()
        updated = req.model_copy(
            update={
                "status": StockRequestStatus.APPROVED,
                "approver_open_id": approver_open_id,
                "approver_name": approver_name,
                "transaction_id": tx.id,
                "reviewed_at": reviewed_at,
            }
        )
        self.requests[request_id] = updated
        return updated

    def reject_request(
        self,
        request_id: str,
        approver_open_id: str,
        approver_name: str,
        reason: str,
    ) -> StockRequest:
        req = self.requests.get(request_id)
        if not req:
            raise ValueError("request_not_found")
        if req.status != StockRequestStatus.PENDING:
            raise ValueError("request_already_reviewed")
        updated = req.model_copy(
            update={
                "status": StockRequestStatus.REJECTED,
                "approver_open_id": approver_open_id,
                "approver_name": approver_name,
                "reject_reason": reason,
                "reviewed_at": _utcnow(),
            }
        )
        self.requests[request_id] = updated
        return updated

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
            quantity=-qty,
            operator=operator,
            remark=remark,
            created_at=_utcnow(),
        )
        self.transactions[tx_id] = tx
        return tx

    def apply_transfer(
        self,
        material_id: str,
        from_location_id: str,
        to_location_id: str,
        qty: int,
        operator: str,
        remark: str | None,
    ) -> list[Transaction]:
        if material_id not in self.materials:
            raise ValueError("material_not_found")
        if from_location_id == to_location_id:
            raise ValueError("same_location")
        if from_location_id not in self.locations or to_location_id not in self.locations:
            raise ValueError("location_not_found")

        source_key = (material_id, from_location_id)
        target_key = (material_id, to_location_id)
        if source_key not in self.inventory or self.inventory[source_key].quantity < qty:
            available = self.inventory[source_key].quantity if source_key in self.inventory else 0
            raise ValueError(f"insufficient_stock:{available}")

        now = _utcnow()
        self.inventory[source_key].quantity -= qty
        self.inventory[source_key].last_updated = now
        target_loc = self.locations[to_location_id]
        if target_key in self.inventory:
            self.inventory[target_key].quantity += qty
            self.inventory[target_key].last_updated = now
        else:
            self.inventory[target_key] = InventoryItem(
                material_id=material_id,
                location_id=to_location_id,
                location_name=target_loc.name,
                quantity=qty,
                last_updated=now,
            )

        material = self.materials[material_id]
        source_loc = self.locations[from_location_id]
        tx = Transaction(
            id=f"tx_{len(self.transactions) + 1:04d}",
            type=TransactionType.TRANSFER,
            material_id=material_id,
            material_name=material.name,
            location_id=from_location_id,
            location_name=source_loc.name,
            quantity=-qty,
            operator=operator,
            remark=f"移动至 {target_loc.name}" + (f"；{remark}" if remark else ""),
            created_at=now,
        )
        self.transactions[tx.id] = tx
        return [tx]

    def snapshot(self) -> dict[str, Any]:
        return {
            "categories": len(self.categories),
            "locations": len(self.locations),
            "materials": len(self.materials),
            "inventory": len(self.inventory),
            "transactions": len(self.transactions),
            "requests": len(self.requests),
        }


_store: MockStore | None = None


def get_mock_store() -> MockStore:
    global _store
    if _store is None:
        _store = MockStore()
    return _store
