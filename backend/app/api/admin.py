from fastapi import APIRouter, Depends

from app.config import Settings, get_settings
from app.middleware.auth import require_roles
from app.models import BulkSyncRequest, Role, User
from app.services.inventory import InventoryService
from app.utils.response import success

router = APIRouter(prefix="/admin", tags=["admin"])


def get_service(settings: Settings = Depends(get_settings)) -> InventoryService:
    return InventoryService(settings)


@router.post("/bulk-sync")
async def bulk_sync(
    payload: BulkSyncRequest,
    _user: User = Depends(require_roles(Role.ADMIN)),
    service: InventoryService = Depends(get_service),
):
    data = await service.bulk_sync(payload.dry_run)
    return success(data)
