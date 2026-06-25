from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, Query

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


def _table_label_map(settings: Settings) -> dict[str, str]:
    return {
        settings.bitable_table_categories: "分类",
        settings.bitable_table_locations: "库位",
        settings.bitable_table_materials: "物料",
        settings.bitable_table_inventory: "库存",
        settings.bitable_table_transactions: "流水",
        settings.bitable_table_requests: "申请",
    }


def _labeled_table_rows(settings: Settings, snapshot: dict[str, int]) -> list[dict[str, str | int]]:
    labels = _table_label_map(settings)
    rows: list[dict[str, str | int]] = []
    for table_id, count in snapshot.items():
        rows.append({"id": table_id, "label": labels.get(table_id, "其他"), "count": count})
    rows.sort(key=lambda row: str(row["label"]))
    return rows


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
    background_tasks: BackgroundTasks,
    _user: User = Depends(require_roles(Role.KEEPER, Role.ADMIN)),
    service: InventoryService = Depends(get_service),
    settings: Settings = Depends(get_settings),
):
    use_background = settings.sqlite_cache_enabled and settings.bitable_mode == "real"
    data = await service.refresh_cache(background=use_background)
    if data.get("async"):
        background_tasks.add_task(service.refresh_cache_remote)
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


@router.delete("/transactions/{transaction_id}")
async def delete_transaction(
    transaction_id: str,
    _user: User = Depends(require_roles(Role.ADMIN)),
    service: InventoryService = Depends(get_service),
):
    await service.delete_transaction(transaction_id)
    return success({"deleted": True, "transaction_id": transaction_id})


@router.delete("/requests/{request_id}")
async def delete_request(
    request_id: str,
    _user: User = Depends(require_roles(Role.ADMIN)),
    service: InventoryService = Depends(get_service),
):
    await service.delete_request(request_id)
    return success({"deleted": True, "request_id": request_id})


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


# ── 审批人列表 ──

@router.get("/approvers")
async def list_approvers(
    _user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    """返回可选审批人列表（管理员 open_id + 姓名）。"""
    admins: list[dict[str, str]] = []
    for entry in settings.feishu_role_overrides.split(","):
        entry = entry.strip()
        if not entry:
            continue
        parts = entry.split(":", 1)
        if len(parts) >= 2 and parts[1].strip() == "ADMIN":
            admins.append({"open_id": parts[0].strip(), "name": parts[0].strip()})
    return success(admins)


# ── 审批抄送设置 ──

@router.get("/cc-settings")
async def get_cc_settings(
    _user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    return success({
        "cc_enabled": settings.feishu_cc_enabled,
        "cc_recipients": _cc_admin_ids(settings),
    })


@router.patch("/cc-settings")
async def update_cc_settings(
    enabled: bool = Query(...),
    _user: User = Depends(require_roles(Role.ADMIN)),
    settings: Settings = Depends(get_settings),
):
    settings.feishu_cc_enabled = enabled
    return success({"cc_enabled": enabled, "message": "抄送设置已更新"})


def _cc_admin_ids(settings: Settings) -> list[str]:
    ids: list[str] = []
    for entry in settings.feishu_role_overrides.split(","):
        entry = entry.strip()
        if not entry: continue
        parts = entry.split(":", 1)
        if len(parts) >= 2 and parts[1].strip() == "ADMIN":
            ids.append(parts[0].strip())
    return ids


# ── SQLite 缓存管理 ──

@router.post("/sqlite-sync")
async def sync_sqlite_cache(
    background_tasks: BackgroundTasks,
    _user: User = Depends(require_roles(Role.ADMIN)),
    settings: Settings = Depends(get_settings),
    service: InventoryService = Depends(get_service),
):
    """将 Bitable 数据同步到本地 SQLite（与 /cache/refresh 共用刷新逻辑）。"""
    if not settings.sqlite_cache_enabled or settings.bitable_mode != "real":
        return success({"synced": False, "message": "SQLite 缓存未启用或非 real 模式"})
    data = await service.refresh_cache(background=True)
    background_tasks.add_task(service.refresh_cache_remote)
    from app.bitable.sqlite_cache import get_sqlite_cache

    sqlite = get_sqlite_cache()
    snapshot = sqlite.snapshot()
    return success({
        "synced": True,
        "async": True,
        "message": data.get("message"),
        "tables": snapshot,
        "labeled_tables": _labeled_table_rows(settings, snapshot),
    })


@router.get("/sqlite-status")
async def sqlite_cache_status(
    _user: User = Depends(require_roles(Role.ADMIN)),
    settings: Settings = Depends(get_settings),
):
    """查看本地 SQLite 缓存状态。"""
    if not settings.sqlite_cache_enabled:
        return success({"enabled": False})
    from app.bitable.sqlite_cache import get_sqlite_cache
    sqlite = get_sqlite_cache()
    snapshot = sqlite.snapshot()
    return success({
        "enabled": True,
        "snapshot": snapshot,
        "labeled_tables": _labeled_table_rows(settings, snapshot),
        "sync_interval": settings.sqlite_cache_sync_interval,
    })


@router.post("/sqlite-backup")
async def backup_sqlite_cache(
    _user: User = Depends(require_roles(Role.ADMIN)),
    settings: Settings = Depends(get_settings),
):
    """备份 SQLite 数据库文件到同目录 .bak 文件。"""
    from app.bitable.sqlite_cache import DB_PATH
    import shutil
    backup_path = DB_PATH.with_suffix(".db.bak")
    try:
        shutil.copy2(str(DB_PATH), str(backup_path))
        size_mb = backup_path.stat().st_size / 1024 / 1024
        return success({"backed_up": True, "path": str(backup_path), "size_mb": round(size_mb, 2)})
    except FileNotFoundError:
        return success({"backed_up": False, "message": "SQLite 数据库文件不存在"})


@router.post("/sqlite-reset")
async def reset_sqlite_cache(
    _user: User = Depends(require_roles(Role.ADMIN)),
    settings: Settings = Depends(get_settings),
):
    """清空 SQLite 缓存（下次启动或访问时自动从 Bitable 恢复）。"""
    if not settings.sqlite_cache_enabled:
        return success({"reset": False, "message": "SQLite 缓存未启用"})
    from app.bitable.sqlite_cache import get_sqlite_cache
    sqlite = get_sqlite_cache()
    core_ids = [
        settings.bitable_table_categories, settings.bitable_table_locations,
        settings.bitable_table_materials, settings.bitable_table_inventory,
        settings.bitable_table_transactions, settings.bitable_table_requests,
    ]
    for table_id in core_ids:
        if table_id:
            sqlite.clear_table(table_id)
    return success({"reset": True, "message": "SQLite 缓存已清空，下次请求将自动从 Bitable 恢复"})


# ── 流水归档管理 ──

@router.post("/transactions/archive")
async def archive_transactions(
    before_days: int = Query(default=90, ge=30, le=730, description="归档 N 天前的流水"),
    _user: User = Depends(require_roles(Role.ADMIN)),
    settings: Settings = Depends(get_settings),
):
    """将 N 天前的流水从主缓存移到归档表。"""
    if not settings.sqlite_cache_enabled:
        return success({"archived": 0, "message": "SQLite 缓存未启用"})
    from app.bitable.sqlite_cache import get_sqlite_cache
    sqlite = get_sqlite_cache()
    count = sqlite.archive_before(settings.bitable_table_transactions, before_days)
    return success({"archived": count, "before_days": before_days, "stats": sqlite.archive_stats(settings.bitable_table_transactions)})


@router.get("/transactions/archive-stats")
async def archive_stats(
    _user: User = Depends(require_roles(Role.ADMIN)),
    settings: Settings = Depends(get_settings),
):
    """查看流水归档统计（active / archived 数量）。"""
    from app.bitable.sqlite_cache import get_sqlite_cache
    sqlite = get_sqlite_cache()
    return success(sqlite.archive_stats(settings.bitable_table_transactions))
