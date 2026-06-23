"""物料 API —— 搜索 + CRUD"""
from fastapi import APIRouter, Depends, Query
from app.auth.deps import get_current_user
from app.config import Settings, get_settings
from app.models import MaterialCreate, User
from app.services.inventory import InventoryService

router = APIRouter(prefix="/materials", tags=["materials"])


def get_service(settings: Settings = Depends(get_settings)) -> InventoryService:
    return InventoryService(settings)


@router.get("/search")
async def search_materials(
    q: str | None = Query(default=None, max_length=100),
    stock_only: bool = Query(default=False),
    page: int = Query(default=1, ge=1, le=1000),
    size: int = Query(default=20, ge=1, le=100),
    _user: User = Depends(get_current_user),
    service: InventoryService = Depends(get_service),
):
    data = await service.search_materials(q, stock_only, page, size)
    return {"code": 0, "data": data.model_dump(mode="json")}


@router.get("/catalog")
async def material_catalog(
    _user: User = Depends(get_current_user),
    service: InventoryService = Depends(get_service),
):
    items = await service.list_material_catalog()
    return {"code": 0, "data": [i.model_dump(mode="json") for i in items]}


@router.get("/categories")
async def list_categories(
    _user: User = Depends(get_current_user),
    service: InventoryService = Depends(get_service),
):
    items = await service.list_categories()
    return {"code": 0, "data": [i.model_dump() for i in items]}


@router.post("")
async def create_material(
    payload: MaterialCreate,
    _user: User = Depends(get_current_user),
    service: InventoryService = Depends(get_service),
):
    material = await service.create_material(payload)
    return {"code": 0, "data": material.model_dump()}


@router.get("/{material_id}")
async def get_material(
    material_id: str,
    _user: User = Depends(get_current_user),
    service: InventoryService = Depends(get_service),
):
    material = service.get_material(material_id)
    if not material:
        return {"code": 4004, "message": "物料未找到", "data": None}
    return {"code": 0, "data": material.model_dump()}
