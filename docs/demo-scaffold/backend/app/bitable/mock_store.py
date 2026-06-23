"""内存 mock 数据 —— 无需 Bitable 即可本地开发"""
from app.models import Material, Category, Location, InventoryItem, MaterialSearchItem, Role, User

# ── 种子数据 ──

MOCK_CATEGORIES: list[Category] = [
    Category(id="cat_elec", name="电气类", level=1),
    Category(id="cat_motor", name="电机模组", parent_id="cat_elec", level=2),
    Category(id="cat_sensor", name="感知设备", parent_id="cat_elec", level=2),
    Category(id="cat_mech", name="机械类", level=1),
    Category(id="cat_metal", name="金属件", parent_id="cat_mech", level=2),
]

MOCK_LOCATIONS: list[Location] = [
    Location(id="loc_a", code="A-01", name="A柜", type="货柜"),
    Location(id="loc_b", code="B-01", name="B柜", type="货柜"),
    Location(id="loc_temp", code="T-01", name="快递暂存区", type="暂存区"),
]

MOCK_MATERIALS: list[Material] = [
    Material(id="mat_001", code="M001", name="大喵电机", category_id="cat_motor",
             category_name="电机模组", unit="个", spec="DM-V2", supplier="达妙科技"),
    Material(id="mat_002", code="M002", name="Realsense相机", category_id="cat_sensor",
             category_name="感知设备", unit="个", spec="D435i", supplier="Intel"),
    Material(id="mat_003", code="M003", name="M3螺栓", category_id="cat_metal",
             category_name="金属件", unit="个", spec="M3x10", supplier="标准件"),
    Material(id="mat_004", code="M004", name="杜邦线", category_id="cat_elec",
             category_name="电气类", unit="根", spec="母对母20cm", supplier="电子市场"),
]

MOCK_INVENTORY: list[InventoryItem] = [
    InventoryItem(material_id="mat_001", location_id="loc_a", location_name="A柜", quantity=8),
    InventoryItem(material_id="mat_002", location_id="loc_a", location_name="A柜", quantity=3),
    InventoryItem(material_id="mat_003", location_id="loc_b", location_name="B柜", quantity=50),
    InventoryItem(material_id="mat_004", location_id="loc_temp", location_name="快递暂存区", quantity=20),
]


class MockStore:
    """线程安全的内存数据存储，mock 模式用。"""

    def __init__(self):
        self.categories: dict[str, Category] = {c.id: c for c in MOCK_CATEGORIES}
        self.locations: dict[str, Location] = {l.id: l for l in MOCK_LOCATIONS}
        self.materials: dict[str, Material] = {m.id: m for m in MOCK_MATERIALS}
        self.inventory: dict[str, InventoryItem] = {
            f"{i.material_id}:{i.location_id}": i for i in MOCK_INVENTORY
        }

    # ── 搜索 ──
    def search_materials(self, q: str | None, stock_only: bool = False,
                         page: int = 1, size: int = 20) -> tuple[list[MaterialSearchItem], int]:
        results = []
        for m in self.materials.values():
            if q and q.lower() not in m.name.lower() and q.lower() not in (m.code or "").lower():
                continue
            qty = sum(i.quantity for k, i in self.inventory.items() if k.startswith(f"{m.id}:"))
            if stock_only and qty <= 0:
                continue
            locs = [i.location_name for k, i in self.inventory.items()
                    if k.startswith(f"{m.id}:") and i.quantity > 0]
            results.append(MaterialSearchItem(
                **m.model_dump(), total_quantity=qty,
                locations_summary=" · ".join(f"{l} {qty}" for l in locs) if locs else None))
        total = len(results)
        start = (page - 1) * size
        return results[start:start + size], total

    # ── CRUD ──
    def get_material(self, material_id: str) -> Material | None:
        return self.materials.get(material_id)

    def create_material(self, payload) -> Material:
        mid = f"mat_{len(self.materials) + 1:04d}"
        m = Material(id=mid, name=payload.name, category_id=payload.category_id,
                     unit=payload.unit, spec=payload.spec, code=payload.code or f"M{len(self.materials) + 1:03d}")
        self.materials[mid] = m
        return m

    def get_location(self, location_id: str) -> Location | None:
        return self.locations.get(location_id)

    def get_inventory(self, material_id: str, location_id: str) -> int:
        key = f"{material_id}:{location_id}"
        return self.inventory[key].quantity if key in self.inventory else 0

    def update_inventory(self, material_id: str, location_id: str, delta: int):
        key = f"{material_id}:{location_id}"
        if key in self.inventory:
            self.inventory[key].quantity += delta
        else:
            loc = self.locations.get(location_id)
            self.inventory[key] = InventoryItem(
                material_id=material_id, location_id=location_id,
                location_name=loc.name if loc else location_id, quantity=delta)


_mock_store: MockStore | None = None


def get_mock_store() -> MockStore:
    global _mock_store
    if _mock_store is None:
        _mock_store = MockStore()
    return _mock_store
