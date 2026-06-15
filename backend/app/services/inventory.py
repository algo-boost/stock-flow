from app.bitable.repository import BitableRepository
from app.bitable.mock_store import get_mock_store
from app.config import Settings
from app.models import (
    Category,
    InboundCreate,
    Material,
    MaterialCreate,
    MaterialDetail,
    OutboundCreate,
    PaginatedMaterials,
    Transaction,
    TransferCreate,
    User,
)
from app.utils.response import AppError


def _wrap_bitable_error(exc: Exception) -> AppError:
    msg = str(exc) or "Bitable 读写失败"
    if "TableIdNotFound" in msg:
        return AppError(
            5002,
            "Bitable 表 ID 无效，请检查 backend/.env 中 BITABLE_TABLE_* 是否与多维表格一致",
            502,
        )
    if "WrongAppToken" in msg or "app_token" in msg.lower():
        return AppError(5002, "Bitable app_token 无效，请使用 /base/ 链接中的 ID", 502)
    return AppError(5002, msg, 502)


class InventoryService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.store = get_mock_store()
        self.repo = BitableRepository(settings) if settings.bitable_mode == "real" else None

    async def search_materials(
        self,
        q: str | None,
        category: str | None,
        location: str | None,
        stock_only: bool,
        page: int,
        size: int,
    ) -> PaginatedMaterials:
        try:
            if self.repo:
                items, total = await self.repo.search_materials(q, category, location, stock_only, page, size)
            else:
                items, total = self.store.search_materials(q, category, location, stock_only, page, size)
        except RuntimeError as exc:
            raise _wrap_bitable_error(exc) from exc
        return PaginatedMaterials(items=items, total=total, page=page, size=size)

    async def list_categories(self) -> list[Category]:
        try:
            if self.repo:
                return await self.repo.list_categories()
            return self.store.list_categories()
        except RuntimeError as exc:
            raise _wrap_bitable_error(exc) from exc

    async def create_material(self, payload: MaterialCreate) -> Material:
        try:
            if self.repo:
                return await self.repo.create_material(payload)
            return self.store.create_material(payload)
        except ValueError as exc:
            msg = str(exc)
            if msg == "category_not_found":
                raise AppError(1001, "分类未找到", 400) from exc
            if msg == "location_not_found":
                raise AppError(1001, "默认库位未找到", 400) from exc
            raise
        except RuntimeError as exc:
            raise _wrap_bitable_error(exc) from exc

    async def get_material_detail(self, material_id: str) -> MaterialDetail:
        try:
            if self.repo:
                material = await self.repo.get_material(material_id)
                if not material:
                    raise AppError(4004, "物料未找到", 404)
                inventory = await self.repo.get_inventory_for_material(material_id)
            else:
                material = self.store.get_material(material_id)
                if not material:
                    raise AppError(4004, "物料未找到", 404)
                inventory = self.store.get_inventory_for_material(material_id)
        except RuntimeError as exc:
            raise _wrap_bitable_error(exc) from exc
        total = sum(i.quantity for i in inventory)
        return MaterialDetail(material=material, inventory=inventory, total_quantity=total)

    async def list_material_catalog(
        self,
        q: str | None = None,
        stock_only: bool = False,
    ) -> list[MaterialDetail]:
        try:
            if self.repo:
                return await self.repo.list_material_catalog(q, stock_only)
            return self.store.list_material_catalog(q, stock_only)
        except RuntimeError as exc:
            raise _wrap_bitable_error(exc) from exc

    async def list_transactions(self, material_id: str, limit: int = 20) -> list[Transaction]:
        if self.repo:
            if not await self.repo.get_material(material_id):
                raise AppError(4004, "物料未找到", 404)
            return await self.repo.get_transactions(material_id, limit)
        if not self.store.get_material(material_id):
            raise AppError(4004, "物料未找到", 404)
        return self.store.get_transactions(material_id, limit)

    async def list_inventory(self, material_id: str | None, location_id: str | None) -> list:
        if self.repo:
            return await self.repo.list_inventory(material_id, location_id)
        return self.store.list_inventory(material_id, location_id)

    async def list_locations(self) -> list:
        try:
            if self.repo:
                return await self.repo.list_locations()
            return list(self.store.locations.values())
        except RuntimeError as exc:
            raise _wrap_bitable_error(exc) from exc

    async def inbound(self, payload: InboundCreate, user: User) -> Transaction:
        try:
            if self.repo:
                return await self.repo.apply_inbound(
                    payload.material_id,
                    payload.location_id,
                    payload.qty,
                    user.open_id,
                    user.name,
                    payload.note,
                )
            return self.store.apply_inbound(
                payload.material_id,
                payload.location_id,
                payload.qty,
                user.name,
                payload.note,
            )
        except ValueError as exc:
            msg = str(exc)
            if msg == "material_not_found":
                raise AppError(4004, "物料未找到", 404) from exc
            if msg == "location_not_found":
                raise AppError(1001, "库位未找到", 400) from exc
            raise
        except RuntimeError as exc:
            raise _wrap_bitable_error(exc) from exc

    async def outbound(self, payload: OutboundCreate, user: User) -> Transaction:
        try:
            if self.repo:
                return await self.repo.apply_outbound(
                    payload.material_id,
                    payload.location_id,
                    payload.qty,
                    user.open_id,
                    user.name,
                    payload.note,
                )
            return self.store.apply_outbound(
                payload.material_id,
                payload.location_id,
                payload.qty,
                user.name,
                payload.note,
            )
        except ValueError as exc:
            msg = str(exc)
            if msg == "material_not_found":
                raise AppError(4004, "物料未找到", 404) from exc
            if msg.startswith("insufficient_stock:"):
                available = msg.split(":", 1)[1]
                raise AppError(4002, f"库存不足: 当前可用 {available}", 400) from exc
            raise
        except RuntimeError as exc:
            raise _wrap_bitable_error(exc) from exc

    async def transfer(self, payload: TransferCreate, user: User) -> list[Transaction]:
        try:
            if self.repo:
                return await self.repo.apply_transfer(
                    payload.material_id,
                    payload.from_location_id,
                    payload.to_location_id,
                    payload.qty,
                    user.open_id,
                    user.name,
                    payload.note,
                )
            return self.store.apply_transfer(
                payload.material_id,
                payload.from_location_id,
                payload.to_location_id,
                payload.qty,
                user.name,
                payload.note,
            )
        except ValueError as exc:
            msg = str(exc)
            if msg == "material_not_found":
                raise AppError(4004, "物料未找到", 404) from exc
            if msg == "location_not_found":
                raise AppError(1001, "库位未找到", 400) from exc
            if msg == "same_location":
                raise AppError(1001, "源库位和目标库位不能相同", 400) from exc
            if msg.startswith("insufficient_stock:"):
                available = msg.split(":", 1)[1]
                raise AppError(4002, f"源库位库存不足: 当前可用 {available}", 400) from exc
            raise
        except RuntimeError as exc:
            raise _wrap_bitable_error(exc) from exc

    async def bulk_sync(self, dry_run: bool) -> dict:
        if self.repo:
            snap = await self.repo.snapshot()
            return {"dry_run": dry_run, "message": "Bitable 数据快照", "tables": snap}
        snap = self.store.snapshot()
        return {"dry_run": dry_run, "message": "mock 数据快照", "tables": snap}

    async def refresh_cache(self) -> dict:
        if self.repo:
            result = await self.repo.refresh_core_tables()
            failed = result.get("failed") or {}
            message = "Bitable 缓存已刷新"
            if failed:
                message = "Bitable 缓存部分刷新失败，已保留旧缓存"
            return {"message": message, **result}
        snap = self.store.snapshot()
        return {"message": "mock 模式无需刷新缓存", "tables": snap}
