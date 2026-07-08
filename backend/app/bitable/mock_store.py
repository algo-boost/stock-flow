from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Optional

from app.utils.request_remark import format_approved_outbound_remark
from app.models import (
    Category,
    CategoryCreate,
    CategoryUpdate,
    InventoryItem,
    InventoryRecordUpdate,
    Location,
    LocationCreate,
    LocationUpdate,
    Material,
    MaterialCreate,
    MaterialDetail,
    MaterialSearchItem,
    MaterialUpdate,
    StockRequest,
    StockRequestCreate,
    StockRequestStatus,
    StockRequestType,
    StockRequestUpdate,
    Transaction,
    TransactionType,
    TransactionUpdate,
    User,
)
from app.data.category_taxonomy import (
    LAB_CATEGORY_TAXONOMY,
    LEAF_CATEGORY_IDS,
    ROOT_CATEGORY_IDS,
)
from app.utils.categories import category_descendant_ids, derive_category_levels, derive_location_levels
from app.utils.inventory_display import format_inventory_summary
from app.utils.applicant import build_proxy_remark
from app.utils.slot_rules import validate_and_normalize_slot, validate_transfer_slots


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


def _build_lab_categories() -> dict[str, Category]:
    categories: dict[str, Category] = {}
    for root in LAB_CATEGORY_TAXONOMY:
        root_id = ROOT_CATEGORY_IDS[root.name]
        categories[root_id] = Category(
            id=root_id,
            name=root.name,
            parent_id=None,
            major_name=root.name,
            default_location_type=root.default_location_type,
            examples=root.examples,
        )
        for leaf in root.children:
            leaf_id = LEAF_CATEGORY_IDS[(root.name, leaf.name)]
            categories[leaf_id] = Category(
                id=leaf_id,
                name=leaf.name,
                parent_id=root_id,
                major_name=root.name,
                sub_name=leaf.name,
                default_location_type=leaf.default_location_type,
                examples=leaf.examples,
            )
    return categories


class MockStore:
    """内存数据存储，BITABLE_MODE=mock 时使用。"""

    def __init__(self) -> None:
        self.categories: dict[str, Category] = {}
        self.locations: dict[str, Location] = {}
        self.location_types: list[str] = []
        self.materials: dict[str, Material] = {}
        self.inventory: dict[InventoryKey, InventoryItem] = {}
        self.transactions: dict[str, Transaction] = {}
        self.requests: dict[str, StockRequest] = {}
        self._seed()

    def _seed(self) -> None:
        self.categories = _build_lab_categories()
        self.locations = {
            "loc_01": Location(id="loc_01", code="A-柜-01", name="A柜", type="货柜", major_name="A柜", grid_rows=4, grid_columns=6),
            "loc_01_l2": Location(id="loc_01_l2", code="A-柜-01-2", name="第二层", type="货柜层", parent_id="loc_01", major_name="A柜", mid_name="第二层"),
            "loc_01_l3": Location(id="loc_01_l3", code="A-柜-01-2-3", name="第三格", type="货柜格", parent_id="loc_01_l2", major_name="A柜", mid_name="第二层", sub_name="第三格"),
            "loc_02": Location(id="loc_02", code="B-架-01", name="B架", type="货架", major_name="B架", grid_rows=5, grid_columns=None),
            "loc_bolt": Location(id="loc_bolt", code="BOLT-01", name="螺栓专用架", type="专用螺栓架", major_name="螺栓专用架"),
            "loc_staging": Location(
                id="loc_staging", code="STAGE-01", name="快递暂存区", type="快递暂存", major_name="快递暂存区"
            ),
        }
        self.materials = {}
        self.inventory = {}
        self.transactions = {}
        self.requests = {}
        self.location_types = ["货柜", "货架", "专用螺栓架", "工具架", "快递暂存", "货柜层", "货柜格"]
        self._seed_test_data()

    def _seed_test_data(self) -> None:
        """预填测试物料、库存和流水，方便前端调试。"""
        now = _utcnow()
        # ── 物料 ──
        test_materials = {
            "mat_001": Material(id="mat_001", code="M001", name="大喵电机", category_id="cat_motor_module", category_name="电机模组", major_category="电气类", sub_category="电机模组", unit="个", spec="DM-Motor V2", supplier="达妙科技", min_stock=5),
            "mat_002": Material(id="mat_002", code="M002", name="Realsense相机", category_id="cat_sensing", category_name="感知设备", major_category="电气类", sub_category="感知设备", unit="个", spec="D435i", supplier="Intel", min_stock=3),
            "mat_003": Material(id="mat_003", code="M003", name="奥比中光相机", category_id="cat_sensing", category_name="感知设备", major_category="电气类", sub_category="感知设备", unit="个", spec="Gemini-335", supplier="奥比中光", min_stock=2),
            "mat_004": Material(id="mat_004", code="M004", name="M3螺栓", category_id="cat_fastener", category_name="螺丝螺栓", major_category="耗材类", sub_category="螺丝螺栓", unit="个", spec="M3x10", supplier="标准件", min_stock=50),
            "mat_005": Material(id="mat_005", code="M005", name="杜邦线", category_id="cat_cable", category_name="线缆网线", major_category="电气类", sub_category="线缆网线", unit="根", spec="母对母 20cm", supplier="电子市场", min_stock=20),
            "mat_006": Material(id="mat_006", code="M006", name="Jetson Orin", category_id="cat_compute", category_name="算力设备", major_category="电气类", sub_category="算力设备", unit="个", spec="Orin NX 16GB", supplier="NVIDIA", min_stock=1),
            "mat_007": Material(id="mat_007", code="M007", name="锂电池包", category_id="cat_battery", category_name="电池电源", major_category="电气类", sub_category="电池电源", unit="个", spec="24V 10Ah", supplier="达妙科技", min_stock=2),
            "mat_008": Material(id="mat_008", code="M008", name="铝合金型材", category_id="cat_metal", category_name="金属件", major_category="机械类", sub_category="金属件", unit="根", spec="2020 1m", supplier="铝材市场", min_stock=10),
            "mat_009": Material(id="mat_009", code="M009", name="测试缺货物料", category_id="cat_cable", category_name="线缆网线", major_category="电气类", sub_category="线缆网线", unit="根", spec="测试", supplier="—", min_stock=5),
        }
        for mid, m in test_materials.items():
            self.materials[mid] = m

        # ── 库存 ──
        self.inventory = {
            inv_key("mat_001", "loc_01", 1, 2): InventoryItem(material_id="mat_001", location_id="loc_01", location_name="A柜", quantity=5, last_updated=now, row=1, column=2),
            inv_key("mat_001", "loc_01", 2, 4): InventoryItem(material_id="mat_001", location_id="loc_01", location_name="A柜", quantity=3, last_updated=now, row=2, column=4),
            inv_key("mat_002", "loc_01", 1, 1): InventoryItem(material_id="mat_002", location_id="loc_01", location_name="A柜", quantity=2, last_updated=now, row=1, column=1),
            inv_key("mat_003", "loc_01"): InventoryItem(material_id="mat_003", location_id="loc_01", location_name="A柜", quantity=1, last_updated=now),
            inv_key("mat_004", "loc_bolt"): InventoryItem(material_id="mat_004", location_id="loc_bolt", location_name="螺栓专用架", quantity=45, last_updated=now),
            inv_key("mat_005", "loc_01", 3, 3): InventoryItem(material_id="mat_005", location_id="loc_01", location_name="A柜", quantity=15, last_updated=now, row=3, column=3),
            inv_key("mat_006", "loc_01", 4, 1): InventoryItem(material_id="mat_006", location_id="loc_01", location_name="A柜", quantity=1, last_updated=now, row=4, column=1),
            inv_key("mat_007", "loc_02", 1, None): InventoryItem(material_id="mat_007", location_id="loc_02", location_name="B架", quantity=2, last_updated=now, row=1),
            inv_key("mat_008", "loc_02", 3, None): InventoryItem(material_id="mat_008", location_id="loc_02", location_name="B架", quantity=8, last_updated=now, row=3),
        }

        # ── 流水 ──
        self.transactions = {
            "tx_001": Transaction(id="tx_001", type=TransactionType.INBOUND, material_id="mat_001", material_name="大喵电机", location_id="loc_01", location_name="A柜", quantity=10, operator="管理员", remark="初始入库", created_at=now),
            "tx_002": Transaction(id="tx_002", type=TransactionType.OUTBOUND, material_id="mat_001", material_name="大喵电机", location_id="loc_01", location_name="A柜", quantity=-2, operator="张工", remark="研发领用：机械臂关节测试", created_at=now),
            "tx_003": Transaction(id="tx_003", type=TransactionType.OUTBOUND, material_id="mat_004", material_name="M3螺栓", location_id="loc_bolt", location_name="螺栓专用架", quantity=-5, operator="李工", remark="组装用", created_at=now),
        }

        # ── 待审批申请（模拟 USER 提交的出入库申请） ──
        self.requests = {
            "req_001": StockRequest(
                id="req_001", type=StockRequestType.OUTBOUND, status=StockRequestStatus.PENDING,
                material_id="mat_001", material_name="大喵电机", location_id="loc_01", location_name="A柜",
                quantity=2, requester_open_id="user_zhang", requester_name="张工",
                remark="需要2个大喵电机做关节测试", return_required=True,
                created_at=now,
            ),
            "req_002": StockRequest(
                id="req_002", type=StockRequestType.INBOUND, status=StockRequestStatus.PENDING,
                material_id="mat_006", material_name="Jetson Orin",
                quantity=1, requester_open_id="user_li", requester_name="李工",
                remark="采购到货，需入库", created_at=now,
            ),
            "req_003": StockRequest(
                id="req_003", type=StockRequestType.OUTBOUND, status=StockRequestStatus.PENDING,
                material_id="mat_002", material_name="Realsense相机", location_id="loc_01", location_name="A柜",
                quantity=1, requester_open_id="user_wang", requester_name="王工",
                remark="视觉项目测试需要", created_at=now,
            ),
        }

    def _material_total_quantity(self, material_id: str) -> int:
        return sum(item.quantity for item in self.get_inventory_for_material(material_id))

    def search_materials(
        self,
        q: str | None = None,
        search_by: str = "all",
        category: str | None = None,
        location: str | None = None,
        stock_only: bool = False,
        out_of_stock: bool = False,
        low_stock: bool = False,
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
                        or (material.mid_category is not None and keyword in material.mid_category.lower())
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
                    or (material.mid_category is not None and keyword in material.mid_category.lower())
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
                    or m.mid_category == category
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
        if out_of_stock:
            items = [m for m in items if self._material_total_quantity(m.id) <= 0]
        if low_stock:
            items = [
                m
                for m in items
                if 0 < self._material_total_quantity(m.id) < (m.min_stock or 5)
            ]
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
        major_name, mid_name, sub_name = derive_category_levels(self.categories, parent_id, name)
        category = Category(
            id=category_id,
            name=name,
            parent_id=parent_id,
            major_name=major_name,
            mid_name=mid_name,
            sub_name=sub_name,
            default_location_type=payload.default_location_type or "货柜",
            examples=payload.examples,
        )
        self.categories[category_id] = category

        # 如果在中类下新增子类，自动把中类下的物料迁移到新子类
        if parent_id and sub_name:
            migrated = 0
            for mat in list(self.materials.values()):
                if mat.category_id == parent_id:
                    self.materials[mat.id] = mat.model_copy(
                        update={
                            "category_id": category.id,
                            "category_name": category.name,
                            "sub_category": sub_name,
                        }
                    )
                    migrated += 1
            if migrated:
                import logging
                _logger = logging.getLogger("stock-flow.mock")
                _logger.info("新增子类 %s → 迁移了 %d 个物料", name, migrated)

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
                "mid_category": category.mid_name,
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

    def update_category(self, category_id: str, payload: CategoryUpdate) -> Category:
        if category_id not in self.categories:
            raise ValueError("category_not_found")
        current = self.categories[category_id]
        updates = payload.model_dump(exclude_unset=True)
        if not updates:
            return current

        name = updates.get("name", current.name)
        if isinstance(name, str):
            name = name.strip()

        parent_id = updates.get("parent_id", current.parent_id)
        # 不能把自己设为父分类，避免循环引用
        if parent_id and parent_id == category_id:
            raise ValueError("category_self_parent")
        if parent_id and parent_id not in self.categories:
            raise ValueError("parent_not_found")
        # 检查同级名称重复
        if "name" in updates:
            if any(
                c.id != category_id and c.name == name and c.parent_id == parent_id
                for c in self.categories.values()
            ):
                raise ValueError("category_name_exists")

        major_name, mid_name, sub_name = derive_category_levels(
            self.categories, parent_id, name
        )
        updated = Category(
            id=category_id,
            name=name,
            parent_id=parent_id,
            major_name=major_name or name,
            mid_name=mid_name,
            sub_name=sub_name,
            default_location_type=updates.get(
                "default_location_type", current.default_location_type
            ),
            examples=updates.get("examples", current.examples),
        )
        self.categories[category_id] = updated

        # 如果分类名称或层级发生变更，同步更新关联物料的分类信息
        for material_id, material in list(self.materials.items()):
            if material.category_id == category_id:
                self._reassign_material_category(material_id, updated)
        return updated

    def create_location(self, payload: LocationCreate) -> Location:
        code = payload.code.strip()
        if any(loc.code == code for loc in self.locations.values()):
            raise ValueError("location_code_exists")
        parent_id = payload.parent_id
        if parent_id and parent_id not in self.locations:
            raise ValueError("location_parent_not_found")
        location_id = f"loc_{len(self.locations) + 1:03d}"
        major_name, mid_name, sub_name = derive_location_levels(self.locations, parent_id, payload.name.strip())
        location = Location(
            id=location_id,
            code=code,
            name=payload.name.strip(),
            type=payload.type.strip() or "货柜",
            parent_id=parent_id,
            major_name=major_name,
            mid_name=mid_name,
            sub_name=sub_name,
            grid_rows=payload.grid_rows,
            grid_columns=payload.grid_columns,
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
        name = payload.name.strip() if payload.name is not None else current.name
        parent_id = payload.parent_id if "parent_id" in payload.model_dump(exclude_unset=True) else current.parent_id
        if parent_id and parent_id == location_id:
            raise ValueError("location_self_parent")
        if parent_id and parent_id not in self.locations:
            raise ValueError("location_parent_not_found")
        major_name, mid_name, sub_name = derive_location_levels(self.locations, parent_id, name)
        updated = Location(
            id=location_id,
            code=code,
            name=name,
            type=payload.type.strip() if payload.type is not None else current.type,
            parent_id=parent_id,
            major_name=major_name or name,
            mid_name=mid_name,
            sub_name=sub_name,
            grid_rows=payload.grid_rows if "grid_rows" in payload.model_dump(exclude_unset=True) else current.grid_rows,
            grid_columns=(
                payload.grid_columns if "grid_columns" in payload.model_dump(exclude_unset=True) else current.grid_columns
            ),
        )
        self.locations[location_id] = updated
        for item in self.inventory.values():
            if item.location_id == location_id:
                item.location_name = updated.name
        return updated

    def delete_location(self, location_id: str) -> None:
        if location_id not in self.locations:
            raise ValueError("location_not_found")
        # 递归删除子库位
        for child in [l for l in self.locations.values() if l.parent_id == location_id]:
            self.delete_location(child.id)
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
            mid_category=payload.mid_category or category.mid_name or "",
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

    def update_material(self, material_id: str, payload: MaterialUpdate) -> Material:
        material = self.materials.get(material_id)
        if not material:
            raise ValueError("material_not_found")
        updates = payload.model_dump(exclude_unset=True)
        if not updates:
            return material
        if "category_id" in updates and updates["category_id"] not in self.categories:
            raise ValueError("category_not_found")
        if updates.get("default_location_id") and updates["default_location_id"] not in self.locations:
            raise ValueError("location_not_found")
        category = self.categories.get(updates.get("category_id", material.category_id))

        def _optional_text(key: str) -> str | None:
            if key not in updates:
                return getattr(material, key)
            value = updates[key]
            if value is None:
                return None
            stripped = str(value).strip()
            return stripped or None

        merged = material.model_copy(
            update={
                **{k: v for k, v in updates.items() if k not in {"category_id", "major_category", "mid_category", "sub_category", "spec", "barcode", "supplier"}},
                "name": updates["name"].strip() if "name" in updates else material.name,
                "unit": updates["unit"].strip() if "unit" in updates else material.unit,
                "category_id": updates.get("category_id", material.category_id),
                "category_name": category.name if category else material.category_name,
                "major_category": updates.get(
                    "major_category",
                    category.major_name if category and "category_id" in updates else material.major_category,
                ),
                "mid_category": updates.get(
                    "mid_category",
                    category.mid_name if category and "category_id" in updates else material.mid_category,
                ),
                "sub_category": updates.get(
                    "sub_category",
                    category.sub_name if category and "category_id" in updates else material.sub_category,
                ),
                "spec": _optional_text("spec"),
                "barcode": _optional_text("barcode"),
                "supplier": _optional_text("supplier"),
            }
        )
        self.materials[material_id] = merged
        return merged

    def delete_material(self, material_id: str) -> None:
        if material_id not in self.materials:
            raise ValueError("material_not_found")
        stock = sum(
            inv.quantity
            for (mid, _, _, _), inv in self.inventory.items()
            if mid == material_id and inv.quantity > 0
        )
        if stock > 0:
            raise ValueError(f"material_has_stock:{stock}")
        if any(tx.material_id == material_id for tx in self.transactions.values()):
            raise ValueError("material_has_transactions")
        if any(req.material_id == material_id for req in self.requests.values()):
            raise ValueError("material_has_requests")
        del self.materials[material_id]
        for key in [k for k in self.inventory if k[0] == material_id]:
            del self.inventory[key]

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
        tx_type: str | None = None,
        location_id: str | None = None,
        page: int = 1,
        size: int = 20,
        limit: int | None = None,
    ) -> tuple[list[Transaction], int]:
        txs = list(self.transactions.values())
        if operator:
            txs = [tx for tx in txs if tx.operator == operator]
        if tx_type:
            txs = [tx for tx in txs if tx.type.value == tx_type]
        if location_id:
            txs = [tx for tx in txs if tx.location_id == location_id]
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
        total = len(txs)
        effective_size = limit if limit is not None else size
        start = max(page - 1, 0) * effective_size
        return txs[start : start + effective_size], total

    def list_all_transactions(self) -> list[Transaction]:
        return list(self.transactions.values())

    def get_transaction(self, transaction_id: str) -> Transaction | None:
        return self.transactions.get(transaction_id)

    def find_request_by_transaction_id(self, transaction_id: str) -> StockRequest | None:
        for req in self.requests.values():
            if req.transaction_id == transaction_id:
                return req
        return None

    def create_request(
        self,
        payload: StockRequestCreate,
        requester_open_id: str,
        requester_name: str,
        *,
        actor: User | None = None,
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
        remark = build_proxy_remark(payload.note, actor, requester_open_id) if actor else payload.note
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
            remark=remark,
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

        if req.type == StockRequestType.INBOUND:
            approval_note = f"{req.remark or ''}；审批人：{approver_name}".strip("；")
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
            approval_note = format_approved_outbound_remark(
                req.remark,
                return_required=req.return_required,
                return_due_at=req.return_due_at,
                row=out_row,
                column=out_column,
                approver_name=approver_name,
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
        loc = self.locations[location_id]
        row, column = validate_and_normalize_slot(loc, row, column, slots_enabled=True)
        key = inv_key(material_id, location_id, row, column)
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

        from_loc = self.locations[from_location_id]
        to_loc = self.locations[to_location_id]
        from_row, from_column, to_row, to_column = validate_transfer_slots(
            from_loc,
            to_loc,
            from_row,
            from_column,
            to_row,
            to_column,
            slots_enabled=True,
        )

        source_key = inv_key(material_id, from_location_id, from_row, from_column)
        if source_key not in self.inventory or self.inventory[source_key].quantity < qty:
            available = self.inventory[source_key].quantity if source_key in self.inventory else 0
            raise ValueError(f"insufficient_stock:{available}")

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

    def list_location_types(self) -> list[str]:
        return list(self.location_types)

    def add_location_type(self, name: str) -> list[str]:
        name = name.strip()
        if not name:
            raise ValueError("location_type_name_empty")
        if name in self.location_types:
            raise ValueError("location_type_exists")
        self.location_types.append(name)
        self.location_types.sort()
        return list(self.location_types)

    def remove_location_type(self, name: str) -> list[str]:
        name = name.strip()
        if name not in self.location_types:
            raise ValueError("location_type_not_found")
        # 检查是否有库位正在使用此类型
        used = any(loc.type == name for loc in self.locations.values())
        if used:
            raise ValueError("location_type_in_use")
        self.location_types.remove(name)
        return list(self.location_types)

    def update_location_type(self, old_name: str, new_name: str) -> list[str]:
        old_name = old_name.strip()
        new_name = new_name.strip()
        if old_name not in self.location_types:
            raise ValueError("location_type_not_found")
        if new_name in self.location_types:
            raise ValueError("location_type_exists")
        idx = self.location_types.index(old_name)
        self.location_types[idx] = new_name
        # 同步更新使用此类型的所有库位
        for loc in self.locations.values():
            if loc.type == old_name:
                self.locations[loc.id] = loc.model_copy(update={"type": new_name})
        self.location_types.sort()
        return list(self.location_types)

    def snapshot(self) -> dict[str, Any]:
        return {
            "categories": len(self.categories),
            "locations": len(self.locations),
            "materials": len(self.materials),
            "inventory": len(self.inventory),
            "transactions": len(self.transactions),
            "requests": len(self.requests),
        }

    # ── 管理员纠错方法 ──

    def update_transaction(self, transaction_id: str, payload: "TransactionUpdate") -> Transaction:
        tx = self.transactions.get(transaction_id)
        if not tx:
            raise ValueError("transaction_not_found")
        updates = payload.model_dump(exclude_unset=True)
        if not updates:
            return tx
        merged = tx.model_copy(update=updates)
        self.transactions[transaction_id] = merged
        return merged

    def update_request(self, request_id: str, payload: "StockRequestUpdate") -> StockRequest:
        req = self.requests.get(request_id)
        if not req:
            raise ValueError("request_not_found")
        updates = payload.model_dump(exclude_unset=True)
        if not updates:
            return req
        merged = req.model_copy(update=updates)
        self.requests[request_id] = merged
        return merged

    def update_inventory_record(
        self, material_id: str, location_id: str, payload: "InventoryRecordUpdate",
        row: int | None = None, column: int | None = None,
    ) -> InventoryItem:
        key = inv_key(material_id, location_id, row, column)
        if key not in self.inventory:
            raise ValueError("inventory_not_found")
        item = self.inventory[key]
        now = _utcnow()
        updated = item.model_copy(
            update={
                "quantity": payload.quantity,
                "last_updated": now,
            }
        )
        self.inventory[key] = updated
        return updated

    def delete_transaction(self, transaction_id: str) -> None:
        if transaction_id not in self.transactions:
            raise ValueError("transaction_not_found")
        tx = self.transactions[transaction_id]
        self._revert_inventory_for_transaction(tx)
        del self.transactions[transaction_id]

    def _parse_slot_from_remark(self, remark: str | None) -> tuple[int | None, int | None]:
        if not remark:
            return None, None
        match = re.search(r"(\d+)行(\d+)列", remark)
        if not match:
            return None, None
        return int(match.group(1)), int(match.group(2))

    def _revert_inventory_for_transaction(self, tx: Transaction) -> None:
        if tx.type == TransactionType.TRANSFER:
            raise ValueError("transfer_tx_cannot_delete")

        row, column = self._parse_slot_from_remark(tx.remark)
        key = inv_key(tx.material_id, tx.location_id, row, column)
        now = _utcnow()
        loc = self.locations.get(tx.location_id)

        if tx.type == TransactionType.INBOUND:
            qty = abs(tx.quantity)
            if key not in self.inventory or self.inventory[key].quantity < qty:
                available = self.inventory[key].quantity if key in self.inventory else 0
                raise ValueError(f"insufficient_stock_to_revert:{available}")
            item = self.inventory[key]
            if item.quantity == qty:
                del self.inventory[key]
            else:
                self.inventory[key] = item.model_copy(
                    update={"quantity": item.quantity - qty, "last_updated": now}
                )
            return

        if tx.type == TransactionType.OUTBOUND:
            qty = abs(tx.quantity)
            if key in self.inventory:
                item = self.inventory[key]
                self.inventory[key] = item.model_copy(
                    update={"quantity": item.quantity + qty, "last_updated": now}
                )
            else:
                self.inventory[key] = InventoryItem(
                    material_id=tx.material_id,
                    location_id=tx.location_id,
                    location_name=loc.name if loc else tx.location_name,
                    quantity=qty,
                    last_updated=now,
                    row=row,
                    column=column,
                )
            return

        raise ValueError("unsupported_tx_type")

    def delete_request(self, request_id: str) -> None:
        if request_id not in self.requests:
            raise ValueError("request_not_found")
        del self.requests[request_id]


_store: MockStore | None = None


def seed_test_materials(store: MockStore) -> None:
    """单元测试用最小物料样本；正式 mock 启动默认不加载物料。"""
    now = _utcnow()
    store.materials = {
        "mat_001": Material(
            id="mat_001",
            code="M001",
            name="大喵电机",
            category_id="cat_motor_module",
            category_name="电机模组",
            major_category="电气类",
            sub_category="电机模组",
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
            major_category="电气类",
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
            major_category="电气类",
            sub_category="感知设备",
            unit="个",
            spec="Gemini-335",
            barcode="6900004",
            default_location_id="loc_01",
            supplier="奥比中光",
            min_stock=5,
        ),
        "mat_empty": Material(
            id="mat_empty",
            code="M009",
            name="测试缺货物料",
            category_id="cat_sensing",
            category_name="感知设备",
            major_category="电气类",
            sub_category="感知设备",
            unit="根",
            spec="测试",
            default_location_id="loc_01",
            min_stock=5,
        ),
    }
    store.inventory = {
        inv_key("mat_001", "loc_01"): InventoryItem(
            material_id="mat_001",
            location_id="loc_01",
            location_name="电气类A柜-01",
            quantity=3,
            last_updated=now,
        ),
        inv_key("mat_realsense", "loc_01"): InventoryItem(
            material_id="mat_realsense",
            location_id="loc_01",
            location_name="电气类A柜-01",
            quantity=2,
            last_updated=now,
        ),
        inv_key("mat_orbbec", "loc_01"): InventoryItem(
            material_id="mat_orbbec",
            location_id="loc_01",
            location_name="电气类A柜-01",
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
