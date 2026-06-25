from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.auth.deps import get_current_user
from app.config import Settings, get_settings
from app.middleware.auth import require_roles
from app.models import LocationCreate, LocationUpdate, Role, User
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


@router.post("/locations")
async def create_location(
    payload: LocationCreate,
    _user: User = Depends(require_roles(Role.KEEPER, Role.ADMIN)),
    service: InventoryService = Depends(get_service),
):
    location = await service.create_location(payload)
    return success(location.model_dump())


@router.patch("/locations/{location_id}")
async def update_location(
    location_id: str,
    payload: LocationUpdate,
    _user: User = Depends(require_roles(Role.KEEPER, Role.ADMIN)),
    service: InventoryService = Depends(get_service),
):
    location = await service.update_location(location_id, payload)
    return success(location.model_dump())


@router.delete("/locations/{location_id}")
async def delete_location(
    location_id: str,
    _user: User = Depends(require_roles(Role.KEEPER, Role.ADMIN)),
    service: InventoryService = Depends(get_service),
):
    await service.delete_location(location_id)
    return success({"deleted": True})


@router.get("/inventory/low-stock")
async def list_low_stock(
    _user: User = Depends(require_roles(Role.ADMIN)),
    service: InventoryService = Depends(get_service),
):
    items = await service.list_low_stock()
    return success([item.model_dump(mode="json") for item in items])


@router.get("/inventory")
async def list_inventory(
    material_id: str | None = Query(default=None),
    location_id: str | None = Query(default=None),
    _user: User = Depends(get_current_user),
    service: InventoryService = Depends(get_service),
):
    items = await service.list_inventory(material_id, location_id)
    return success([i.model_dump(mode="json") for i in items])


@router.get("/inventory/staging")
async def list_staging_inventory(
    _user: User = Depends(require_roles(Role.KEEPER, Role.ADMIN)),
    service: InventoryService = Depends(get_service),
):
    items = await service.list_staging_inventory()
    return success([i.model_dump(mode="json") for i in items])
