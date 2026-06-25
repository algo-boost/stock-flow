from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.api.transactions import get_service
from app.auth.deps import get_current_user
from app.middleware.auth import require_roles
from app.models import (
    DispositionStatus,
    LoanClosureCreate,
    LoanClosureDirect,
    LoanClosureReject,
    Role,
    User,
)
from app.services.inventory import InventoryService
from app.utils.response import success

router = APIRouter(tags=["returns"])


@router.get("/returns/pending")
async def list_pending_returns(
    borrower: str | None = Query(default=None, max_length=100),
    user: User = Depends(get_current_user),
    service: InventoryService = Depends(get_service),
):
    effective_borrower = borrower
    if user.role == Role.USER:
        effective_borrower = user.name
    items = await service.list_pending_returns(borrower=effective_borrower)
    return success([item.model_dump(mode="json") for item in items])


@router.get("/returns/closure-requests")
async def list_closure_requests(
    status: DispositionStatus | None = Query(default=None),
    user: User = Depends(get_current_user),
    service: InventoryService = Depends(get_service),
):
    items = await service.list_closure_requests(user, status=status)
    return success([item.model_dump(mode="json") for item in items])


@router.post("/returns/closure-requests")
async def create_closure_request(
    payload: LoanClosureCreate,
    user: User = Depends(get_current_user),
    service: InventoryService = Depends(get_service),
):
    item = await service.create_closure_request(payload, user)
    return success(item.model_dump(mode="json"))


@router.post("/returns/closure-requests/{request_id}/approve")
async def approve_closure_request(
    request_id: str,
    user: User = Depends(require_roles(Role.KEEPER, Role.ADMIN)),
    service: InventoryService = Depends(get_service),
):
    item = await service.approve_closure_request(request_id, user)
    return success(item.model_dump(mode="json"))


@router.post("/returns/closure-requests/{request_id}/reject")
async def reject_closure_request(
    request_id: str,
    payload: LoanClosureReject,
    user: User = Depends(require_roles(Role.KEEPER, Role.ADMIN)),
    service: InventoryService = Depends(get_service),
):
    item = await service.reject_closure_request(request_id, payload, user)
    return success(item.model_dump(mode="json"))


@router.post("/returns/close")
async def direct_close_borrow(
    payload: LoanClosureDirect,
    user: User = Depends(require_roles(Role.KEEPER, Role.ADMIN)),
    service: InventoryService = Depends(get_service),
):
    tx = await service.direct_close_borrow(payload, user)
    return success({"transaction_id": tx.id})
