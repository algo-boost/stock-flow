"""鉴权依赖 —— get_current_user + mock 模式"""
from fastapi import Depends, Header, HTTPException, Request
from app.config import Settings, get_settings
from app.models import Role, User


def _extract_bearer(authorization: str | None) -> str | None:
    if not authorization:
        return None
    parts = authorization.split()
    return parts[1] if len(parts) == 2 and parts[0].lower() == "bearer" else None


def _role_from_header(value: str | None) -> Role:
    if not value:
        return Role.USER
    v = value.upper().strip()
    if v in ("ADMIN", "KEEPER"):
        return Role(v)
    return Role.USER


async def get_current_user(
    request: Request,
    settings: Settings = Depends(get_settings),
    authorization: str | None = Header(default=None),
    x_mock_role: str | None = Header(default=None, alias="X-Mock-Role"),
) -> User:
    token = _extract_bearer(authorization)
    if token:
        # TODO: 接入真实 session store
        raise HTTPException(status_code=401, detail="登录已过期")

    if settings.mock_auth_enabled:
        role = _role_from_header(x_mock_role)
        return User(
            open_id="mock-user",
            name={Role.ADMIN: "管理员", Role.KEEPER: "库管员"}.get(role, "用户"),
            role=role,
        )

    raise HTTPException(status_code=401, detail="未登录")
