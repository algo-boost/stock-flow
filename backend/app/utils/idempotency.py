from __future__ import annotations

import time
from typing import Any

_IDEMPOTENCY_CACHE: dict[str, tuple[float, Any]] = {}
TTL_SECONDS = 24 * 3600


def get_idempotent(key: str) -> Any | None:
    entry = _IDEMPOTENCY_CACHE.get(key)
    if not entry:
        return None
    expires_at, value = entry
    if time.time() > expires_at:
        _IDEMPOTENCY_CACHE.pop(key, None)
        return None
    return value


def set_idempotent(key: str, value: Any) -> None:
    _IDEMPOTENCY_CACHE[key] = (time.time() + TTL_SECONDS, value)


def clear_idempotency_cache() -> None:
    _IDEMPOTENCY_CACHE.clear()
