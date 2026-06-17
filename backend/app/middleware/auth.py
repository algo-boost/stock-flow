from collections.abc import Callable
from typing import Any

from fastapi import Depends, HTTPException

from app.auth.deps import get_current_user
from app.models import Role, User

ROLE_RANK: dict[Role, int] = {
    Role.USER: 10,
    Role.KEEPER: 20,
    Role.ADMIN: 30,
}


def role_allows(actual: Role, required: Role) -> bool:
    return ROLE_RANK[actual] >= ROLE_RANK[required]


def require_roles(*roles: Role) -> Callable[..., Any]:
    required = set(roles)

    async def checker(user: User = Depends(get_current_user)) -> User:
        if not any(role_allows(user.role, role) for role in required):
            raise HTTPException(status_code=403, detail="权限不足")
        return user

    return checker
