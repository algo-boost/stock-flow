import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.utils.idempotency import clear_idempotency_cache

client = TestClient(app)
HEADERS_USER = {"X-Mock-Role": "USER", "X-Mock-User": "test_user"}
HEADERS_KEEPER = {"X-Mock-Role": "KEEPER", "X-Mock-User": "test_keeper"}


@pytest.fixture(autouse=True)
def reset_idempotency():
    clear_idempotency_cache()
    yield
    clear_idempotency_cache()


def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_me():
    resp = client.get("/me", headers=HEADERS_USER)
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 0
    assert body["data"]["user"]["role"] == "USER"


def test_search_materials():
    resp = client.get("/materials/search?q=大喵", headers=HEADERS_USER)
    assert resp.status_code == 200
    items = resp.json()["data"]["items"]
    assert len(items) >= 1
    assert items[0]["name"] == "大喵电机"


def test_outbound_success():
    key = "test-outbound-key-001"
    resp = client.post(
        "/outbound",
        headers=HEADERS_USER,
        json={
            "material_id": "mat_001",
            "location_id": "loc_01",
            "qty": 1,
            "idempotency_key": key,
            "note": "项目测试领用",
        },
    )
    assert resp.status_code == 200
    assert resp.json()["code"] == 0
    tx_id = resp.json()["data"]["transaction_id"]
    assert tx_id

    # 幂等：重复请求返回相同结果
    resp2 = client.post(
        "/outbound",
        headers=HEADERS_USER,
        json={
            "material_id": "mat_001",
            "location_id": "loc_01",
            "qty": 1,
            "idempotency_key": key,
            "note": "项目测试领用",
        },
    )
    assert resp2.json()["data"]["transaction_id"] == tx_id


def test_outbound_insufficient_stock():
    resp = client.post(
        "/outbound",
        headers=HEADERS_USER,
        json={
            "material_id": "mat_001",
            "location_id": "loc_01",
            "qty": 9999,
            "idempotency_key": "test-outbound-overflow",
            "note": "超额领用",
        },
    )
    assert resp.status_code == 400
    assert resp.json()["code"] == 4002


def test_inbound_forbidden_for_user():
    resp = client.post(
        "/inbound",
        headers=HEADERS_USER,
        json={
            "material_id": "mat_001",
            "location_id": "loc_01",
            "qty": 1,
            "idempotency_key": "test-inbound-user-deny",
            "note": "归还",
        },
    )
    assert resp.status_code == 403


def test_inbound_success_for_keeper():
    resp = client.post(
        "/inbound",
        headers=HEADERS_KEEPER,
        json={
            "material_id": "mat_001",
            "location_id": "loc_01",
            "qty": 2,
            "idempotency_key": "test-inbound-keeper-001",
            "note": "采购入库",
        },
    )
    assert resp.status_code == 200
    assert resp.json()["code"] == 0
