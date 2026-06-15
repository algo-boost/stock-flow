import secrets
import time
from dataclasses import dataclass, field
from typing import Any

from app.config import get_settings
from app.models import User


@dataclass
class SessionEntry:
    user: User
    expires_at: float
    role_meta: dict[str, Any] = field(default_factory=dict)


_sessions: dict[str, SessionEntry] = {}


def create_session(user: User, role_meta: dict[str, Any] | None = None) -> str:
    settings = get_settings()
    token = secrets.token_urlsafe(32)
    _sessions[token] = SessionEntry(
        user=user,
        expires_at=time.time() + settings.session_ttl_seconds,
        role_meta=role_meta or {},
    )
    return token


def get_session(token: str) -> User | None:
    entry = get_session_entry(token)
    return entry.user if entry else None


def get_session_entry(token: str) -> SessionEntry | None:
    entry = _sessions.get(token)
    if not entry:
        return None
    if time.time() > entry.expires_at:
        _sessions.pop(token, None)
        return None
    settings = get_settings()
    if settings.session_sliding_ttl:
        entry.expires_at = time.time() + settings.session_ttl_seconds
    return entry


def clear_sessions() -> None:
    _sessions.clear()
