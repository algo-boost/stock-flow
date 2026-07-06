"""共享测试夹具：mock Bitable + mock 鉴权。"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.bitable.mock_store import reset_mock_store
from app.config import Settings, get_settings
from app.main import app
from app.utils.idempotency import clear_idempotency_cache

app.dependency_overrides[get_settings] = lambda: Settings(
    bitable_mode="mock",
    mock_auth_enabled=True,
    bitable_warmup_on_startup=False,
)

HEADERS_USER = {"X-Mock-Role": "USER", "X-Mock-User": "test_user"}
HEADERS_KEEPER = {"X-Mock-Role": "KEEPER", "X-Mock-User": "test_keeper"}
HEADERS_ADMIN = {"X-Mock-Role": "ADMIN", "X-Mock-User": "test_admin"}

# mock A柜（loc_01）测试用格位
CABINET_SLOT = {"row": 1, "column": 1}
CABINET_SLOT_ALT = {"row": 2, "column": 3}


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture(autouse=True)
def _reset_mock_data():
    reset_mock_store()
    clear_idempotency_cache()
    yield
    reset_mock_store()
    clear_idempotency_cache()
