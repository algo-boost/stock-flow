from collections.abc import Callable
from typing import Any

from fastapi import Depends, HTTPException

from app.auth.deps import get_current_user
from app.models import Role, User


def require_roles(*roles: Role) -> Callable[..., Any]:
    allowed = set(roles)

    async def checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in allowed:
            raise HTTPException(status_code=403, detail="权限不足")
        return user

    return checker
