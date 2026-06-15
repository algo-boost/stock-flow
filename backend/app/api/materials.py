from fastapi import APIRouter, Depends, Query

from app.auth.deps import get_current_user
from app.config import Settings, get_settings
from app.middleware.auth import require_roles
from app.models import MaterialCreate, Role, User
from app.services.inventory import InventoryService
from app.utils.response import success

router = APIRouter(prefix="/materials", tags=["materials"])


def get_service(settings: Settings = Depends(get_settings)) -> InventoryService:
    return InventoryService(settings)


@router.get("/search")
async def search_materials(
    q: str | None = Query(default=None, max_length=100),
    category: str | None = Query(default=None, max_length=64),
    location: str | None = Query(default=None, max_length=64),
    stock_only: bool = Query(default=False),
    page: int = Query(default=1, ge=1, le=1000),
    size: int = Query(default=20, ge=1, le=100),
    _user: User = Depends(get_current_user),
    service: InventoryService = Depends(get_service),
):
    data = await service.search_materials(q, category, location, stock_only, page, size)
    return success(data.model_dump())


@router.get("/catalog")
async def material_catalog(
    q: str | None = Query(default=None, max_length=100),
    stock_only: bool = Query(default=False),
    _user: User = Depends(get_current_user),
    service: InventoryService = Depends(get_service),
):
    """从 Bitable 拉取物料目录（含各库位库存），供出入库页使用。"""
    items = await service.list_material_catalog(q, stock_only)
    return success([item.model_dump(mode="json") for item in items])


@router.get("/categories")
async def list_categories(
    _user: User = Depends(get_current_user),
    service: InventoryService = Depends(get_service),
):
    items = await service.list_categories()
    return success([item.model_dump() for item in items])


@router.post("")
async def create_material(
    payload: MaterialCreate,
    _user: User = Depends(require_roles(Role.KEEPER, Role.ADMIN)),
    service: InventoryService = Depends(get_service),
):
    material = await service.create_material(payload)
    return success(material.model_dump())


@router.get("/{material_id}")
async def get_material(
    material_id: str,
    _user: User = Depends(get_current_user),
    service: InventoryService = Depends(get_service),
):
    data = await service.get_material_detail(material_id)
    return success(data.model_dump())


@router.get("/{material_id}/transactions")
async def get_material_transactions(
    material_id: str,
    limit: int = Query(default=20, ge=1, le=100),
    _user: User = Depends(get_current_user),
    service: InventoryService = Depends(get_service),
):
    txs = await service.list_transactions(material_id, limit)
    return success([t.model_dump(mode="json") for t in txs])
