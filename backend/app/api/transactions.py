from fastapi import APIRouter, Depends

from app.auth.deps import get_current_user
from app.config import Settings, get_settings
from app.middleware.auth import require_roles
from app.models import (
    InboundCreate,
    OutboundCreate,
    Role,
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
    user: User = Depends(get_current_user),
    service: InventoryService = Depends(get_service),
):
    cached = get_idempotent(payload.idempotency_key)
    if cached:
        return success(cached)
    tx = await service.outbound(payload, user)
    result = TransactionResult(transaction_id=tx.id).model_dump()
    set_idempotent(payload.idempotency_key, result)
    return success(result)
