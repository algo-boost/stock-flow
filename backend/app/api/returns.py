from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.api.transactions import get_service
from app.auth.deps import get_current_user
from app.models import Role, User
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
