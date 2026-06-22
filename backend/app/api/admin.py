from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query

from app.config import Settings, get_settings
from app.middleware.auth import require_roles
from app.auth.deps import get_current_user
from app.models import (
    BulkSyncRequest,
    InventoryRecordUpdate,
    Role,
    StockRequestUpdate,
    TransactionUpdate,
    User,
)
from app.services.feishu_client import get_role_check_status
from app.services.inventory import InventoryService
from app.utils.response import success

router = APIRouter(prefix="/admin", tags=["admin"])


def get_service(settings: Settings = Depends(get_settings)) -> InventoryService:
    return InventoryService(settings)


def _ensure_timezone(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


@router.post("/bulk-sync")
async def bulk_sync(
    payload: BulkSyncRequest,
    _user: User = Depends(require_roles(Role.ADMIN)),
    service: InventoryService = Depends(get_service),
):
    data = await service.bulk_sync(payload.dry_run)
    return success(data)


@router.post("/cache/refresh")
async def refresh_cache(
    _user: User = Depends(require_roles(Role.KEEPER, Role.ADMIN)),
    service: InventoryService = Depends(get_service),
):
    data = await service.refresh_cache()
    return success(data)


@router.get("/overview")
async def admin_overview(
    start_at: datetime | None = Query(default=None),
    end_at: datetime | None = Query(default=None),
    _user: User = Depends(require_roles(Role.ADMIN)),
    service: InventoryService = Depends(get_service),
):
    data = await service.admin_overview(_ensure_timezone(start_at), _ensure_timezone(end_at))
    return success(data)


@router.get("/audit")
async def admin_audit(
    start_at: datetime | None = Query(default=None),
    end_at: datetime | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    _user: User = Depends(require_roles(Role.ADMIN)),
    service: InventoryService = Depends(get_service),
):
    data = await service.admin_audit(
        start_at=_ensure_timezone(start_at),
        end_at=_ensure_timezone(end_at),
        limit=limit,
    )
    data["role_check"] = get_role_check_status()
    return success(data)


@router.get("/system")
async def admin_system(
    _user: User = Depends(require_roles(Role.ADMIN)),
    settings: Settings = Depends(get_settings),
    service: InventoryService = Depends(get_service),
):
    snap = await service.bulk_sync(dry_run=True)
    return success(
        {
            "app_env": settings.app_env,
            "bitable_mode": settings.bitable_mode,
            "bitable_configured": settings.bitable_configured,
            "feishu_configured": settings.feishu_configured,
            "mock_auth_enabled": settings.mock_auth_enabled,
            "bitable_cache_ttl_seconds": settings.bitable_cache_ttl_seconds,
            "bitable_warmup_on_startup": settings.bitable_warmup_on_startup,
            "session_ttl_seconds": settings.session_ttl_seconds,
            "role_cache_ttl_seconds": settings.feishu_role_cache_ttl_seconds,
            "role_check": get_role_check_status(),
            "tables": snap.get("tables", {}),
            "server_time": datetime.now(timezone.utc).isoformat(),
        }
    )


# ── 管理员纠错端点 ──

@router.patch("/transactions/{transaction_id}")
async def update_transaction(
    transaction_id: str,
    payload: TransactionUpdate,
    _user: User = Depends(require_roles(Role.ADMIN)),
    service: InventoryService = Depends(get_service),
):
    tx = await service.update_transaction(transaction_id, payload)
    return success(tx.model_dump(mode="json"))


@router.patch("/requests/{request_id}")
async def update_request(
    request_id: str,
    payload: StockRequestUpdate,
    _user: User = Depends(require_roles(Role.ADMIN)),
    service: InventoryService = Depends(get_service),
):
    req = await service.update_request(request_id, payload)
    return success(req.model_dump(mode="json"))


@router.patch("/inventory/{material_id}/{location_id}")
async def update_inventory_record(
    material_id: str,
    location_id: str,
    payload: InventoryRecordUpdate,
    row: int | None = Query(default=None, ge=1, le=99),
    column: int | None = Query(default=None, ge=1, le=99),
    _user: User = Depends(require_roles(Role.ADMIN)),
    service: InventoryService = Depends(get_service),
):
    item = await service.update_inventory_record(material_id, location_id, payload, row, column)
    return success(item.model_dump(mode="json"))


# ── 库位类型管理 ──

@router.get("/location-types")
async def list_location_types(
    _user: User = Depends(get_current_user),
    service: InventoryService = Depends(get_service),
):
    types = await service.list_location_types()
    return success(types)


@router.post("/location-types")
async def add_location_type(
    name: str = Query(min_length=1, max_length=50),
    _user: User = Depends(require_roles(Role.KEEPER, Role.ADMIN)),
    service: InventoryService = Depends(get_service),
):
    types = await service.add_location_type(name)
    return success(types)


@router.delete("/location-types")
async def remove_location_type(
    name: str = Query(min_length=1, max_length=50),
    _user: User = Depends(require_roles(Role.ADMIN)),
    service: InventoryService = Depends(get_service),
):
    types = await service.remove_location_type(name)
    return success(types)


@router.patch("/location-types")
async def update_location_type(
    old_name: str = Query(min_length=1, max_length=50),
    new_name: str = Query(min_length=1, max_length=50),
    _user: User = Depends(require_roles(Role.ADMIN)),
    service: InventoryService = Depends(get_service),
):
    types = await service.update_location_type(old_name, new_name)
    return success(types)
