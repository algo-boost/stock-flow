"""认证 API —— health + me"""
from fastapi import APIRouter, Depends
from app.auth.deps import get_current_user
from app.config import Settings, get_settings
from app.models import User

router = APIRouter(tags=["auth"])


@router.get("/health")
async def health(settings: Settings = Depends(get_settings)):
    return {"code": 0, "data": {
        "status": "ok",
        "bitable_mode": settings.bitable_mode,
        "feishu_configured": settings.feishu_configured,
        "bitable_configured": settings.bitable_configured,
        "mock_auth_enabled": settings.mock_auth_enabled,
    }}


@router.get("/me")
async def me(user: User = Depends(get_current_user)):
    return {"code": 0, "data": user.model_dump()}
