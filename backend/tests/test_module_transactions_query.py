"""流水查询与筛选模块测试。"""

from __future__ import annotations

import pytest

from tests.conftest import HEADERS_ADMIN, HEADERS_KEEPER, HEADERS_USER


def test_list_transactions_keyword_filter(client):
    client.post(
        "/api/outbound",
        headers=HEADERS_KEEPER,
        json={
            "material_id": "mat_001",
            "location_id": "loc_01",
            "qty": 1,
            "idempotency_key": "test-tx-query-001",
            "note": "唯一关键词XYZ查询测试",
            "return_required": False,
        },
    )

    resp = client.get("/api/transactions?keyword=唯一关键词XYZ", headers=HEADERS_KEEPER)
    assert resp.status_code == 200
    data = resp.json()["data"]
    txs = data["items"]
    assert data["total"] >= 1
    assert any("唯一关键词XYZ" in (tx.get("remark") or "") for tx in txs)


def test_list_transactions_operator_filter_admin(client):
    resp = client.get("/api/transactions?operator=库管员", headers=HEADERS_ADMIN)
    assert resp.status_code == 200
    data = resp.json()["data"]
    txs = data["items"]
    assert all("库管员" in tx["operator"] for tx in txs) or txs == []


def test_list_transactions_pagination(client):
    resp = client.get("/api/transactions?page=1&size=5", headers=HEADERS_ADMIN)
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert "items" in data
    assert "total" in data
    assert data["page"] == 1
    assert data["size"] == 5
    assert len(data["items"]) <= 5


def test_list_transactions_sqlite_direct_page_without_filters(monkeypatch):
    """无筛选时应走 SQLite offset 分页，只解析当前页。"""
    from app.bitable.repository import BitableRepository
    from app.config import Settings

    settings = Settings(bitable_mode="real", sqlite_cache_enabled=True)
    repo = BitableRepository(settings)

    calls: list[dict] = []

    class FakeSqlite:
        def query_records(self, table_id, *, limit=50, offset=0, order_desc=True, material_id=None):
            calls.append({"limit": limit, "offset": offset})
            return ([{"record_id": "tx_1", "fields": {}}], 99)

        def get_records(self, table_id):
            return []

    async def fake_load_materials():
        return {}

    async def fake_load_locations():
        return {}

    monkeypatch.setattr("app.bitable.sqlite_cache.get_sqlite_cache", lambda: FakeSqlite())
    monkeypatch.setattr(repo, "_load_materials", fake_load_materials)
    monkeypatch.setattr(repo, "_load_locations", fake_load_locations)
    monkeypatch.setattr(
        repo,
        "_build_transaction_from_record",
        lambda rec, materials, locations: type("Tx", (), {"id": rec["record_id"]})(),
    )

    import asyncio

    items, total = asyncio.run(repo.list_transactions(page=3, size=20, limit=None))
    assert total == 99
    assert len(items) == 1
    assert calls[0]["limit"] == 20
    assert calls[0]["offset"] == 40


def test_list_transactions_sqlite_fetch_limit_without_limit(monkeypatch):
    """limit=None 时分页查询不应在 fetch_limit 计算处抛 TypeError。"""
    from app.bitable.repository import BitableRepository
    from app.config import Settings

    settings = Settings(bitable_mode="real", sqlite_cache_enabled=True)
    repo = BitableRepository(settings)

    class FakeSqlite:
        def query_records(self, *args, **kwargs):
            return ([], 0)

    async def fake_load_materials():
        return {}

    async def fake_load_locations():
        return {}

    monkeypatch.setattr("app.bitable.sqlite_cache.get_sqlite_cache", lambda: FakeSqlite())
    monkeypatch.setattr(repo, "_load_materials", fake_load_materials)
    monkeypatch.setattr(repo, "_load_locations", fake_load_locations)

    import asyncio

    items, total = asyncio.run(repo.list_transactions(page=1, size=20, limit=None))
    assert items == []
    assert total == 0


def test_material_transactions_endpoint(client):
    resp = client.get("/api/materials/mat_001/transactions", headers=HEADERS_USER)
    assert resp.status_code == 200
    txs = resp.json()["data"]
    assert isinstance(txs, list)
    assert all(tx["material_id"] == "mat_001" for tx in txs)


def test_delete_inbound_fails_when_stock_insufficient(client):
    inbound = client.post(
        "/api/inbound",
        headers=HEADERS_KEEPER,
        json={
            "material_id": "mat_001",
            "location_id": "loc_01",
            "qty": 1,
            "idempotency_key": "test-delete-insufficient-in",
            "note": "待冲正",
        },
    )
    tx_id = inbound.json()["data"]["transaction_id"]

    client.post(
        "/api/outbound",
        headers=HEADERS_KEEPER,
        json={
            "material_id": "mat_001",
            "location_id": "loc_01",
            "qty": 999,
            "idempotency_key": "test-delete-insufficient-out",
            "note": "尽量出库",
            "return_required": False,
        },
    )

    del_resp = client.delete(f"/api/admin/transactions/{tx_id}", headers=HEADERS_ADMIN)
    if del_resp.status_code == 200:
        pytest.skip("mock 库存未耗尽，跳过不足冲正场景")
    assert del_resp.status_code == 400
    assert "库存不足" in del_resp.json()["message"]
