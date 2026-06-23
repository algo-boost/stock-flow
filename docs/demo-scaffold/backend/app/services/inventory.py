"""业务服务层 —— mock / real 模式统一入口"""
from app.config import Settings
from app.bitable.mock_store import get_mock_store
from app.models import (
    Category, Location, InventoryItem, Material, MaterialCreate,
    MaterialSearchItem, PaginatedMaterials,
)


class InventoryService:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.store = get_mock_store()
        # real 模式时替换为 BitableRepository（见 SKILL.md 模板）
        self.repo = None

    # ── 搜索 ──
    async def search_materials(self, q: str | None, stock_only: bool,
                               page: int, size: int) -> PaginatedMaterials:
        if self.repo:
            items, total = await self.repo.search_materials(q, stock_only, page, size)
        else:
            items, total = self.store.search_materials(q, stock_only, page, size)
        return PaginatedMaterials(items=items, total=total, page=page, size=size)

    # ── 物料 ──
    async def list_material_catalog(self) -> list[MaterialSearchItem]:
        items, _ = self.store.search_materials(None, stock_only=False, page=1, size=1000)
        return items

    def get_material(self, material_id: str) -> Material | None:
        return self.store.get_material(material_id)

    async def create_material(self, payload: MaterialCreate) -> Material:
        if self.repo:
            return await self.repo.create_material(payload)
        return self.store.create_material(payload)

    # ── 分类 ──
    async def list_categories(self) -> list[Category]:
        return list(self.store.categories.values())

    # ── 库位 ──
    def list_locations(self) -> list[Location]:
        return list(self.store.locations.values())

    # ── 库存 ──
    def list_inventory(self) -> list[InventoryItem]:
        return [i for i in self.store.inventory.values() if i.quantity > 0]
