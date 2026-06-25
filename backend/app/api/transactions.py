from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query

from app.auth.deps import get_current_user
from app.config import Settings, get_settings
from app.middleware.auth import require_roles
from app.models import (
    InboundCreate,
    OutboundCreate,
    PurchaseInboundCreate,
    RequestReject,
    Role,
    RequestApprove,
    StockRequestCreate,
    StockRequestResult,
    StockRequestStatus,
    TransactionResult,
    TransferCreate,
    TransferResult,
    User,
)
from app.services.inventory import InventoryService
from app.utils.idempotency import get_idempotent, set_idempotent
from app.utils.response import success

router = APIRouter(tags=["transactions"])


def get_service(settings: Settings = Depends(get_settings)) -> InventoryService:
    return InventoryService(settings)


def _ensure_timezone(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


@router.post("/inbound")
async def inbound(
    payload: InboundCreate,
    user: User = Depends(require_roles(Role.KEEPER, Role.ADMIN)),
    service: InventoryService = Depends(get_service),
):
    cached = get_idempotent(payload.idempotency_key)
    if cached:
        return success(cached)
    tx = await service.inbound(payload, user)
    result = TransactionResult(transaction_id=tx.id).model_dump()
    set_idempotent(payload.idempotency_key, result)
    return success(result)


@router.post("/purchase-inbound")
async def purchase_inbound(
    payload: PurchaseInboundCreate,
    user: User = Depends(require_roles(Role.ADMIN)),
    service: InventoryService = Depends(get_service),
):
    cached = get_idempotent(payload.idempotency_key)
    if cached:
        return success(cached)
    tx = await service.purchase_inbound(payload, user)
    result = TransactionResult(transaction_id=tx.id).model_dump()
    set_idempotent(payload.idempotency_key, result)
    return success(result)


@router.post("/transfer")
async def transfer(
    payload: TransferCreate,
    user: User = Depends(require_roles(Role.KEEPER, Role.ADMIN)),
    service: InventoryService = Depends(get_service),
):
    cached = get_idempotent(payload.idempotency_key)
    if cached:
        return success(cached)
    txs = await service.transfer(payload, user)
    result = TransferResult(transaction_ids=[tx.id for tx in txs]).model_dump()
    set_idempotent(payload.idempotency_key, result)
    return success(result)


@router.post("/outbound")
async def outbound(
    payload: OutboundCreate,
    user: User = Depends(require_roles(Role.KEEPER, Role.ADMIN)),
    service: InventoryService = Depends(get_service),
):
    cached = get_idempotent(payload.idempotency_key)
    if cached:
        return success(cached)
    tx = await service.outbound(payload, user)
    result = TransactionResult(transaction_id=tx.id).model_dump()
    set_idempotent(payload.idempotency_key, result)
    return success(result)


@router.post("/requests")
async def create_request(
    payload: StockRequestCreate,
    user: User = Depends(get_current_user),
    service: InventoryService = Depends(get_service),
    settings: Settings = Depends(get_settings),
):
    cached = get_idempotent(payload.idempotency_key)
    if cached:
        return success(cached)
    req = await service.create_request(payload, user)
    result = StockRequestResult(request_id=req.id).model_dump()
    set_idempotent(payload.idempotency_key, result)

    # 异步通知审批人 + 抄送
    from app.services.notifications import notify_new_request, notify_request_cc
    asyncio.create_task(notify_new_request(
        StockRequestResult(
            request_id=req.id, type=req.type, material_name=req.material_name,
            material_id=req.material_id, quantity=req.quantity,
            requester_name=req.requester_name, requester_open_id=req.requester_open_id,
            remark=req.remark,
        ),
        payload.approver_open_id, settings,
    ))
    asyncio.create_task(notify_request_cc(
        StockRequestResult(
            request_id=req.id, type=req.type, material_name=req.material_name,
            material_id=req.material_id, quantity=req.quantity,
            requester_name=req.requester_name, requester_open_id=req.requester_open_id,
            remark=req.remark,
        ),
        payload.approver_open_id, settings,
    ))

    return success(result)


@router.get("/requests/mine")
async def my_requests(
    status: StockRequestStatus | None = Query(default=None),
    keyword: str | None = Query(default=None, max_length=100),
    limit: int = Query(default=100, ge=1, le=500),
    user: User = Depends(get_current_user),
    service: InventoryService = Depends(get_service),
):
    items = await service.list_requests(
        user=user,
        status=status,
        keyword=keyword,
        limit=limit,
        mine=True,
    )
    return success([item.model_dump(mode="json") for item in items])


@router.get("/requests")
async def list_requests(
    status: StockRequestStatus | None = Query(default=None),
    keyword: str | None = Query(default=None, max_length=100),
    limit: int = Query(default=100, ge=1, le=500),
    user: User = Depends(require_roles(Role.ADMIN)),
    service: InventoryService = Depends(get_service),
):
    items = await service.list_requests(
        user=user,
        status=status,
        keyword=keyword,
        limit=limit,
        mine=False,
    )
    return success([item.model_dump(mode="json") for item in items])


@router.post("/requests/{request_id}/approve")
async def approve_request(
    request_id: str,
    payload: RequestApprove | None = None,
    user: User = Depends(require_roles(Role.ADMIN)),
    service: InventoryService = Depends(get_service),
    settings: Settings = Depends(get_settings),
):
    item = await service.approve_request(request_id, payload or RequestApprove(), user)
    # 异步通知申请人
    from app.services.notifications import notify_request_approved
    asyncio.create_task(notify_request_approved(
        StockRequestResult(
            request_id=item.id, type=item.type, material_name=item.material_name,
            material_id=item.material_id, quantity=item.quantity,
            requester_name=item.requester_name, requester_open_id=item.requester_open_id,
            remark=item.remark,
        ), settings,
    ))
    return success(item.model_dump(mode="json"))


@router.post("/requests/{request_id}/reject")
async def reject_request(
    request_id: str,
    payload: RequestReject,
    user: User = Depends(require_roles(Role.ADMIN)),
    service: InventoryService = Depends(get_service),
    settings: Settings = Depends(get_settings),
):
    item = await service.reject_request(request_id, payload, user)
    # 异步通知申请人
    from app.services.notifications import notify_request_rejected
    asyncio.create_task(notify_request_rejected(
        StockRequestResult(
            request_id=item.id, type=item.type, material_name=item.material_name,
            material_id=item.material_id, quantity=item.quantity,
            requester_name=item.requester_name, requester_open_id=item.requester_open_id,
            remark=item.remark,
        ), payload.reason, settings,
    ))
    return success(item.model_dump(mode="json"))


@router.get("/transactions")
async def list_transactions(
    keyword: str | None = Query(default=None, max_length=100),
    operator: str | None = Query(default=None, max_length=100),
    start_at: datetime | None = Query(default=None),
    end_at: datetime | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    user: User = Depends(get_current_user),
    service: InventoryService = Depends(get_service),
):
    items = await service.search_transactions(
        user=user,
        keyword=keyword,
        operator=operator,
        start_at=_ensure_timezone(start_at),
        end_at=_ensure_timezone(end_at),
        limit=limit,
    )
    return success([item.model_dump(mode="json") for item in items])
