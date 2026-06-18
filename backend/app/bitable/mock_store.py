from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

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
from app.utils.inventory_display import format_inventory_summary


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


InventoryKey = tuple[str, str, Optional[int], Optional[int]]


def inv_key(
    material_id: str,
    location_id: str,
    row: Optional[int] = None,
    column: Optional[int] = None,
) -> InventoryKey:
    """同一库位下不同货柜格位为独立库存记录。"""
    return (material_id, location_id, row, column)


def _resolve_outbound_slot(
    inventory: dict[InventoryKey, InventoryItem],
    material_id: str,
    location_id: str,
    qty: int,
    row: Optional[int] = None,
    column: Optional[int] = None,
) -> tuple[Optional[int], Optional[int]]:
    """审批出库时确定格位：优先用申请/审批指定，否则从该库位可用库存中自动选取。"""
    if row is not None and column is not None:
        return row, column

    candidates: list[tuple[Optional[int], Optional[int], int]] = []
    for (mid, lid, r, c), inv in inventory.items():
        if mid == material_id and lid == location_id and inv.quantity > 0:
            candidates.append((r, c, inv.quantity))
    if not candidates:
        return row, column

    for r, c, available in candidates:
        if r is None and c is None and available >= qty:
            return None, None

    slotted = sorted(
        [(r, c, available) for r, c, available in candidates if r is not None and c is not None],
        key=lambda item: (-item[2], item[0], item[1]),
    )
    for r, c, available in slotted:
        if available >= qty:
            return r, c
    return row, column


class MockStore:
    """内存数据存储，BITABLE_MODE=mock 时使用。"""

    def __init__(self) -> None:
        self.categories: dict[str, Category] = {}
        self.locations: dict[str, Location] = {}
        self.materials: dict[str, Material] = {}
        self.inventory: dict[InventoryKey, InventoryItem] = {}
        self.transactions: dict[str, Transaction] = {}
        self.requests: dict[str, StockRequest] = {}
        self._seed()

    def _seed(self) -> None:
        self.categories = {
            "cat_electrical": Category(
                id="cat_electrical",
                name="电器类",
                parent_id=None,
                major_name="电器类",
                default_location_type="货柜",
                examples="电机、传感器、算力板、线缆等电子电气物料",
            ),
            "cat_motor_module": Category(
                id="cat_motor_module",
                name="电机模组",
                parent_id="cat_electrical",
                major_name="电器类",
                sub_name="电机模组",
                default_location_type="货柜",
                examples="同川电机、达妙电机、本末电机、驱动器",
            ),
            "cat_sensing": Category(
                id="cat_sensing",
                name="感知设备",
                parent_id="cat_electrical",
                major_name="电器类",
                sub_name="感知设备",
                default_location_type="货柜",
                examples="激光雷达、2D相机、3D相机、IMU",
            ),
            "cat_compute": Category(
                id="cat_compute",
                name="算力设备",
                parent_id="cat_electrical",
                major_name="电器类",
                sub_name="算力设备",
                default_location_type="货柜",
                examples="机器人大脑、小脑、底盘大脑、电控板、PCB",
            ),
            "cat_electrical_equip": Category(
                id="cat_electrical_equip",
                name="电气设备",
                parent_id="cat_electrical",
                major_name="电器类",
                sub_name="电气设备",
                default_location_type="货柜",
                examples="开关、分线盒、按钮、端子排、pBox",
            ),
            "cat_general": Category(
                id="cat_general",
                name="通用设备",
                parent_id="cat_electrical",
                major_name="电器类",
                sub_name="通用设备",
                default_location_type="货柜",
                examples="插线板、路由器、交换机",
            ),
            "cat_cable": Category(
                id="cat_cable",
                name="线缆网线",
                parent_id="cat_electrical",
                major_name="电器类",
                sub_name="线缆网线",
                default_location_type="货柜",
                examples="网线、电源线、信号线、USB/HDMI线",
            ),
            "cat_battery": Category(
                id="cat_battery",
                name="电池电源",
                parent_id="cat_electrical",
                major_name="电器类",
                sub_name="电池电源",
                default_location_type="货架",
                examples="锂电池、电池包、充电器、电源模块",
            ),
            "cat_motor_dm": Category(
                id="cat_motor_dm",
                name="达妙电机",
                parent_id="cat_motor_module",
                major_name="电器类",
                sub_name="达妙电机",
                default_location_type="货柜",
            ),
            "cat_motor_tc": Category(
                id="cat_motor_tc",
                name="同川电机",
                parent_id="cat_motor_module",
                major_name="电器类",
                sub_name="同川电机",
                default_location_type="货柜",
            ),
            "cat_motor_bm": Category(
                id="cat_motor_bm",
                name="本末电机",
                parent_id="cat_motor_module",
                major_name="电器类",
                sub_name="本末电机",
                default_location_type="货柜",
            ),
            "cat_motor_driver": Category(
                id="cat_motor_driver",
                name="驱动器",
                parent_id="cat_motor_module",
                major_name="电器类",
                sub_name="驱动器",
                default_location_type="货柜",
            ),
            "cat_mechanical": Category(
                id="cat_mechanical",
                name="机械类",
                parent_id=None,
                major_name="机械类",
                default_location_type="货架",
                examples="全向轮、夹爪、减速器、结构件、螺栓等",
            ),
            "cat_end_effector": Category(
                id="cat_end_effector",
                name="末端执行",
                parent_id="cat_mechanical",
                major_name="机械类",
                sub_name="末端执行",
                default_location_type="货架",
                examples="开合夹爪、平行夹爪、灵巧手、吸盘、快换盘",
            ),
            "cat_transmission": Category(
                id="cat_transmission",
                name="传动部件",
                parent_id="cat_mechanical",
                major_name="机械类",
                sub_name="传动部件",
                default_location_type="货架",
                examples="行星减速器、谐波减速器、联轴器、同步带轮",
            ),
            "cat_mobility": Category(
                id="cat_mobility",
                name="移动部件",
                parent_id="cat_mechanical",
                major_name="机械类",
                sub_name="移动部件",
                default_location_type="货架",
                examples="全向轮、万向轮、脚轮、履带轮",
            ),
            "cat_metal": Category(
                id="cat_metal",
                name="金属件",
                parent_id="cat_mechanical",
                major_name="机械类",
                sub_name="金属件",
                default_location_type="货架",
                examples="机加工件、外观件、铝型材、钣金件、CNC件",
            ),
            "cat_structure": Category(
                id="cat_structure",
                name="结构件",
                parent_id="cat_mechanical",
                major_name="机械类",
                sub_name="结构件",
                default_location_type="货架",
                examples="框架、支架、连接件、标准结构模组、治具底板",
            ),
            "cat_fastener": Category(
                id="cat_fastener",
                name="螺丝螺栓",
                parent_id="cat_mechanical",
                major_name="机械类",
                sub_name="螺丝螺栓",
                default_location_type="专用螺栓架",
                examples="内六角、法兰螺栓、专用螺丝、螺母、垫圈",
            ),
            "cat_mech_other": Category(
                id="cat_mech_other",
                name="其他物品",
                parent_id="cat_mechanical",
                major_name="机械类",
                sub_name="其他物品",
                default_location_type="货架",
                examples="操作台、3D打印机、大板件、标准件、3D打印件",
            ),
            "cat_maintenance": Category(
                id="cat_maintenance",
                name="维修类",
                parent_id=None,
                major_name="维修类",
                default_location_type="工具架",
                examples="维修工具、耗材、备件",
            ),
            "cat_tool": Category(
                id="cat_tool",
                name="工具",
                parent_id="cat_maintenance",
                major_name="维修类",
                sub_name="工具",
                default_location_type="工具架",
                examples="常用工具、专用工具、测量工具",
            ),
            "cat_spare": Category(
                id="cat_spare",
                name="维修备件",
                parent_id="cat_maintenance",
                major_name="维修类",
                sub_name="维修备件",
                default_location_type="货柜",
                examples="易损件、替换模组、维修耗材",
            ),
        }
        self.locations = {
            "loc_01": Location(id="loc_01", code="A-柜-01", name="电器类A柜-01", type="货柜"),
            "loc_02": Location(id="loc_02", code="B-架-01", name="机械类B架-01", type="货架"),
            "loc_bolt": Location(id="loc_bolt", code="BOLT-01", name="螺栓专用架-01", type="专用螺栓架"),
            "loc_staging": Location(
                id="loc_staging", code="STAGE-01", name="快递暂存区", type="快递暂存"
            ),
        }
        self.materials = {}
        self.inventory = {}
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
                    or (material.spec is not None and keyword in material.spec.lower())
                    or (material.supplier is not None and keyword in material.supplier.lower())
                    or (material.barcode is not None and keyword in material.barcode.lower())
                    or (material.category_name is not None and keyword in material.category_name.lower())
                    or (material.major_category is not None and keyword in material.major_category.lower())
                    or (material.sub_category is not None and keyword in material.sub_category.lower())
                )

            items = [m for m in items if match(m)]
        if category:
            if category in self.categories:
                allowed_ids = category_descendant_ids(self.categories, category)
                items = [m for m in items if m.category_id in allowed_ids]
            else:
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
                mid for (mid, lid, _, _), inv in self.inventory.items() if lid == location and inv.quantity > 0
            }
            items = [m for m in items if m.id in mat_ids]
        if stock_only:
            mat_ids = {
                mid for (mid, _, _, _), inv in self.inventory.items() if inv.quantity > 0
            }
            items = [m for m in items if m.id in mat_ids]
        total = len(items)
        start = (page - 1) * size
        return [self._to_search_item(m) for m in items[start : start + size]], total

    def _to_search_item(self, material: Material) -> MaterialSearchItem:
        inventory = self.get_inventory_for_material(material.id)
        total = sum(i.quantity for i in inventory)
        summary = format_inventory_summary(inventory)
        return MaterialSearchItem(
            **material.model_dump(),
            total_quantity=total,
            locations_summary=summary or None,
        )

    def get_material(self, material_id: str) -> Material | None:
        return self.materials.get(material_id)

    def list_categories(self) -> list[Category]:
        return list(self.categories.values())

    def create_category(self, payload: CategoryCreate) -> Category:
        name = payload.name.strip()
        parent_id = payload.parent_id
        if parent_id and parent_id not in self.categories:
            raise ValueError("parent_not_found")
        if any(c.name == name and c.parent_id == parent_id for c in self.categories.values()):
            raise ValueError("category_name_exists")
        category_id = f"cat_{len(self.categories) + 1:03d}"
        major_name, sub_name = derive_major_sub_names(self.categories, parent_id, name)
        category = Category(
            id=category_id,
            name=name,
            parent_id=parent_id,
            major_name=major_name,
            sub_name=sub_name,
            default_location_type=payload.default_location_type or "货柜",
            examples=payload.examples,
        )
        self.categories[category_id] = category
        return category

    def _reassign_material_category(self, material_id: str, category: Category) -> None:
        material = self.materials.get(material_id)
        if not material:
            return
        self.materials[material_id] = material.model_copy(
            update={
                "category_id": category.id,
                "category_name": category.name,
                "major_category": category.major_name,
                "sub_category": category.sub_name,
            }
        )

    def delete_category(self, category_id: str) -> None:
        if category_id not in self.categories:
            raise ValueError("category_not_found")

        for child in [c for c in self.categories.values() if c.parent_id == category_id]:
            self.delete_category(child.id)

        category = self.categories[category_id]
        parent = self.categories.get(category.parent_id) if category.parent_id else None
        blocked: list[str] = []
        for material in list(self.materials.values()):
            if material.category_id != category_id:
                continue
            if parent:
                self._reassign_material_category(material.id, parent)
            else:
                blocked.append(material.name)

        if blocked:
            raise ValueError(f"category_in_use:{','.join(blocked)}")

        del self.categories[category_id]

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
                or (m.spec and keyword in m.spec.lower())
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
        return sorted(
            (
                inv
                for (mid, _, _, _), inv in self.inventory.items()
                if mid == material_id and inv.quantity > 0
            ),
            key=lambda item: (item.location_id, item.row or 0, item.column or 0),
        )

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
        material = self.materials[payload.material_id]
        location = self.locations.get(payload.location_id) if payload.location_id else None
        if payload.type == StockRequestType.OUTBOUND:
            if not location:
                raise ValueError("location_not_found")
        elif payload.location_id and not location:
            raise ValueError("location_not_found")
        request_id = f"req_{len(self.requests) + 1:04d}"
        req = StockRequest(
            id=request_id,
            type=payload.type,
            status=StockRequestStatus.PENDING,
            material_id=payload.material_id,
            material_name=material.name,
            location_id=payload.location_id,
            location_name=location.name if location else None,
            quantity=payload.qty,
            requester_open_id=requester_open_id,
            requester_name=requester_name,
            remark=payload.note,
            return_required=payload.return_required,
            return_due_at=payload.return_due_at,
            row=payload.row,
            column=payload.column,
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
        *,
        location_id: str | None = None,
        row: int | None = None,
        column: int | None = None,
    ) -> StockRequest:
        req = self.requests.get(request_id)
        if not req:
            raise ValueError("request_not_found")
        if req.status != StockRequestStatus.PENDING:
            raise ValueError("request_already_reviewed")

        approval_note = f"{req.remark or ''}；审批人：{approver_name}".strip("；")
        if req.type == StockRequestType.INBOUND:
            target_location_id = location_id or req.location_id
            if not target_location_id or target_location_id not in self.locations:
                raise ValueError("location_required_for_inbound_approval")
            target_location = self.locations[target_location_id]
            tx = self.apply_inbound(
                req.material_id,
                target_location_id,
                req.quantity,
                req.requester_name,
                approval_note,
                row=row,
                column=column,
            )
        else:
            if not req.location_id or req.location_id not in self.locations:
                raise ValueError("location_not_found")
            out_row = row if row is not None else req.row
            out_column = column if column is not None else req.column
            out_row, out_column = _resolve_outbound_slot(
                self.inventory,
                req.material_id,
                req.location_id,
                req.quantity,
                out_row,
                out_column,
            )
            tx = self.apply_outbound(
                req.material_id,
                req.location_id,
                req.quantity,
                req.requester_name,
                approval_note,
                row=out_row,
                column=out_column,
            )
            target_location_id = req.location_id
            target_location = self.locations[target_location_id]

        reviewed_at = _utcnow()
        updated = req.model_copy(
            update={
                "status": StockRequestStatus.APPROVED,
                "location_id": target_location_id,
                "location_name": target_location.name,
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
        row: int | None = None,
        column: int | None = None,
    ) -> Transaction:
        if material_id not in self.materials:
            raise ValueError("material_not_found")
        if location_id not in self.locations:
            raise ValueError("location_not_found")
        if (row is None) ^ (column is None):
            raise ValueError("slot_incomplete")
        key = inv_key(material_id, location_id, row, column)
        loc = self.locations[location_id]
        now = _utcnow()
        if key in self.inventory:
            item = self.inventory[key]
            self.inventory[key] = item.model_copy(
                update={"quantity": item.quantity + qty, "last_updated": now}
            )
        else:
            self.inventory[key] = InventoryItem(
                material_id=material_id,
                location_id=location_id,
                location_name=loc.name,
                quantity=qty,
                last_updated=now,
                row=row,
                column=column,
            )
        tx_id = f"tx_{len(self.transactions) + 1:04d}"
        material = self.materials[material_id]
        slot_note = f"{row}行{column}列" if row is not None and column is not None else None
        full_remark = remark
        if slot_note:
            full_remark = f"{slot_note}" + (f"；{remark}" if remark else "")
        tx = Transaction(
            id=tx_id,
            type=TransactionType.INBOUND,
            material_id=material_id,
            material_name=material.name,
            location_id=location_id,
            location_name=loc.name,
            quantity=qty,
            operator=operator,
            remark=full_remark,
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
        row: int | None = None,
        column: int | None = None,
    ) -> Transaction:
        if material_id not in self.materials:
            raise ValueError("material_not_found")
        key = inv_key(material_id, location_id, row, column)
        if key not in self.inventory or self.inventory[key].quantity < qty:
            available = self.inventory[key].quantity if key in self.inventory else 0
            raise ValueError(f"insufficient_stock:{available}")
        item = self.inventory[key]
        item.quantity -= qty
        item.last_updated = _utcnow()
        if item.quantity <= 0:
            del self.inventory[key]
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

    def update_inventory_slot(
        self,
        material_id: str,
        location_id: str,
        row: int,
        column: int,
        from_row: int | None = None,
        from_column: int | None = None,
    ) -> InventoryItem:
        if material_id not in self.materials:
            raise ValueError("material_not_found")
        if location_id not in self.locations:
            raise ValueError("location_not_found")
        old_key = inv_key(material_id, location_id, from_row, from_column)
        if old_key not in self.inventory or self.inventory[old_key].quantity <= 0:
            raise ValueError("inventory_not_found")
        item = self.inventory.pop(old_key)
        new_key = inv_key(material_id, location_id, row, column)
        now = _utcnow()
        if new_key in self.inventory:
            existing = self.inventory[new_key]
            self.inventory[new_key] = existing.model_copy(
                update={
                    "quantity": existing.quantity + item.quantity,
                    "row": row,
                    "column": column,
                    "last_updated": now,
                }
            )
        else:
            self.inventory[new_key] = item.model_copy(
                update={"row": row, "column": column, "last_updated": now}
            )
        return self.inventory[new_key]

    def apply_transfer(
        self,
        material_id: str,
        from_location_id: str,
        to_location_id: str,
        qty: int,
        operator: str,
        remark: str | None,
        to_row: int | None = None,
        to_column: int | None = None,
        from_row: int | None = None,
        from_column: int | None = None,
    ) -> list[Transaction]:
        if material_id not in self.materials:
            raise ValueError("material_not_found")
        if from_location_id == to_location_id and inv_key(material_id, from_location_id, from_row, from_column) == inv_key(
            material_id, to_location_id, to_row, to_column
        ):
            raise ValueError("same_location")
        if from_location_id not in self.locations or to_location_id not in self.locations:
            raise ValueError("location_not_found")

        source_key = inv_key(material_id, from_location_id, from_row, from_column)
        if source_key not in self.inventory or self.inventory[source_key].quantity < qty:
            available = self.inventory[source_key].quantity if source_key in self.inventory else 0
            raise ValueError(f"insufficient_stock:{available}")

        if (to_row is None) ^ (to_column is None):
            raise ValueError("slot_incomplete")

        now = _utcnow()
        source_item = self.inventory[source_key]
        source_item.quantity -= qty
        source_item.last_updated = now
        if source_item.quantity <= 0:
            del self.inventory[source_key]
        target_loc = self.locations[to_location_id]
        slot_row = to_row if to_row is not None else source_item.row
        slot_col = to_column if to_column is not None else source_item.column
        target_key = inv_key(material_id, to_location_id, slot_row, slot_col)
        if target_key in self.inventory:
            target_item = self.inventory[target_key]
            self.inventory[target_key] = target_item.model_copy(
                update={"quantity": target_item.quantity + qty, "last_updated": now}
            )
        else:
            self.inventory[target_key] = InventoryItem(
                material_id=material_id,
                location_id=to_location_id,
                location_name=target_loc.name,
                quantity=qty,
                last_updated=now,
                row=slot_row,
                column=slot_col,
            )

        material = self.materials[material_id]
        source_loc = self.locations[from_location_id]
        slot_label = f"{slot_row}行{slot_col}列" if slot_row is not None and slot_col is not None else None
        move_target = target_loc.name + (f"（{slot_label}）" if slot_label else "")
        tx = Transaction(
            id=f"tx_{len(self.transactions) + 1:04d}",
            type=TransactionType.TRANSFER,
            material_id=material_id,
            material_name=material.name,
            location_id=from_location_id,
            location_name=source_loc.name,
            quantity=-qty,
            operator=operator,
            remark=f"移动至 {move_target}" + (f"；{remark}" if remark else ""),
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


def seed_test_materials(store: MockStore) -> None:
    """单元测试用最小物料样本；正式 mock 启动默认不加载物料。"""
    now = _utcnow()
    store.materials = {
        "mat_001": Material(
            id="mat_001",
            code="M001",
            name="大喵电机",
            category_id="cat_motor_dm",
            category_name="达妙电机",
            major_category="电器类",
            sub_category="达妙电机",
            unit="个",
            spec="标准版",
            barcode="6900001",
            default_location_id="loc_01",
            supplier="达妙科技",
            min_stock=5,
        ),
        "mat_realsense": Material(
            id="mat_realsense",
            code="LAB-realsense",
            name="Realsense相机",
            category_id="cat_sensing",
            category_name="感知设备",
            major_category="电器类",
            sub_category="感知设备",
            unit="个",
            spec="D435i",
            barcode="6900003",
            default_location_id="loc_01",
            supplier="Intel RealSense",
            min_stock=5,
        ),
        "mat_orbbec": Material(
            id="mat_orbbec",
            code="LAB-orbbec",
            name="奥比中光相机",
            category_id="cat_sensing",
            category_name="感知设备",
            major_category="电器类",
            sub_category="感知设备",
            unit="个",
            spec="Gemini-335",
            barcode="6900004",
            default_location_id="loc_01",
            supplier="奥比中光",
            min_stock=5,
        ),
    }
    store.inventory = {
        inv_key("mat_001", "loc_01"): InventoryItem(
            material_id="mat_001",
            location_id="loc_01",
            location_name="电器类A柜-01",
            quantity=3,
            last_updated=now,
        ),
        inv_key("mat_realsense", "loc_01"): InventoryItem(
            material_id="mat_realsense",
            location_id="loc_01",
            location_name="电器类A柜-01",
            quantity=2,
            last_updated=now,
        ),
        inv_key("mat_orbbec", "loc_01"): InventoryItem(
            material_id="mat_orbbec",
            location_id="loc_01",
            location_name="电器类A柜-01",
            quantity=1,
            last_updated=now,
        ),
    }
    store.transactions = {}
    store.requests = {}


def get_mock_store() -> MockStore:
    global _store
    if _store is None:
        _store = MockStore()
    return _store


def reset_mock_store(*, with_test_materials: bool = True) -> MockStore:
    global _store
    _store = MockStore()
    if with_test_materials:
        seed_test_materials(_store)
    return _store
