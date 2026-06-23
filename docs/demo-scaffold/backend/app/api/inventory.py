"""库存 & 库位 API"""
from fastapi import APIRouter, Depends
from app.auth.deps import get_current_user
from app.config import Settings, get_settings
from app.models import User
from app.services.inventory import InventoryService

router = APIRouter(tags=["inventory"])


def get_service(settings: Settings = Depends(get_settings)) -> InventoryService:
    return InventoryService(settings)


@router.get("/locations")
async def list_locations(
    _user: User = Depends(get_current_user),
    service: InventoryService = Depends(get_service),
):
    items = service.list_locations()
    return {"code": 0, "data": [l.model_dump() for l in items]}


@router.get("/inventory")
async def list_inventory(
    _user: User = Depends(get_current_user),
    service: InventoryService = Depends(get_service),
):
    items = service.list_inventory()
    return {"code": 0, "data": [i.model_dump(mode="json") for i in items]}
