from fastapi import APIRouter, Depends, Query

from app.auth.deps import get_current_user
from app.config import Settings, get_settings
from app.models import User
from app.services.inventory import InventoryService
from app.utils.response import success

router = APIRouter(tags=["inventory"])


def get_service(settings: Settings = Depends(get_settings)) -> InventoryService:
    return InventoryService(settings)


@router.get("/locations")
async def list_locations(
    _user: User = Depends(get_current_user),
    service: InventoryService = Depends(get_service),
):
    items = await service.list_locations()
    return success([loc.model_dump() for loc in items])


@router.get("/inventory")
async def list_inventory(
    material_id: str | None = Query(default=None),
    location_id: str | None = Query(default=None),
    _user: User = Depends(get_current_user),
    service: InventoryService = Depends(get_service),
):
    items = await service.list_inventory(material_id, location_id)
    return success([i.model_dump(mode="json") for i in items])
