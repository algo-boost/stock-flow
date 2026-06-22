from __future__ import annotations

from fastapi import Depends, Header, HTTPException, Request

from app.config import Settings, get_settings
from app.models import Role, User
from app.services.session_store import get_session


def _role_from_header(role_header: str | None) -> Role:
    if not role_header:
        return Role.USER
    try:
        return Role(role_header.upper())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="无效的角色头 X-Mock-Role") from exc


def _extract_bearer(authorization: str | None) -> str | None:
    if authorization and authorization.startswith("Bearer "):
        return authorization[7:].strip()
    return None


async def get_current_user(
    request: Request,
    settings: Settings = Depends(get_settings),
    authorization: str | None = Header(default=None),
    x_mock_role: str | None = Header(default=None, alias="X-Mock-Role"),
    x_mock_user: str | None = Header(default=None, alias="X-Mock-User"),
) -> User:
    token = _extract_bearer(authorization)
    if token:
        user = get_session(token)
        if user:
            return user
        raise HTTPException(status_code=401, detail="登录已过期，请重新授权")

    if settings.mock_auth_enabled:
        role = _role_from_header(x_mock_role)
        open_id = settings.mock_open_id.strip()
        if not open_id and x_mock_user:
            from app.bitable.fields import is_feishu_user_id

            if is_feishu_user_id(x_mock_user):
                open_id = x_mock_user.strip()
        if not open_id:
            open_id = "mock-local-user"
        return User(
            open_id=open_id,
            name={
                "ADMIN": "管理员",
                "KEEPER": "库管员",
                "USER": "研发用户",
            }.get(role.value, "用户"),
            role=role,
        )

    raise HTTPException(status_code=401, detail="未登录，请在飞书客户端中打开或开启 MOCK_AUTH_ENABLED")


async def exchange_code_for_user(code: str, settings: Settings) -> tuple[User, dict]:
    if not settings.feishu_configured:
        raise HTTPException(status_code=503, detail="飞书 App ID / Secret 未配置")

    from app.services.feishu_client import FeishuClient

    client = FeishuClient(settings)
    user, role_meta = await client.exchange_code_for_user(code)
    return user, role_meta
