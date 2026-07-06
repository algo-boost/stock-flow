from __future__ import annotations

import pytest

from app.bitable.bitable_sync import BitableSyncService
from app.bitable.sqlite_cache import SqliteCache
from app.config import Settings


class FakeClient:
    def __init__(self):
        self.created: list[tuple[str, dict]] = []
        self.records: dict[tuple[str, str], dict] = {}

    async def create_record(self, table_id: str, fields: dict, *, user_id_type: str = "open_id"):
        rid = f"rec_sync_{len(self.created)}"
        self.created.append((table_id, fields))
        rec = {"record_id": rid, "fields": {**fields, "操作人": [{"id": "ou_x", "name": "测试员"}]}}
        self.records[(table_id, rid)] = rec
        return rec

    async def update_record(self, table_id: str, record_id: str, fields: dict, *, user_id_type: str = "open_id"):
        rec = {"record_id": record_id, "fields": fields}
        self.records[(table_id, record_id)] = rec
        return rec

    async def delete_record(self, table_id: str, record_id: str) -> None:
        self.records.pop((table_id, record_id), None)

    async def get_record(self, table_id: str, record_id: str, *, user_id_type: str = "open_id"):
        return self.records.get((table_id, record_id), {})


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_sqlite_first_create_enqueues_and_syncs(tmp_path):
    db = tmp_path / "test.db"
    cache = SqliteCache(str(db))
    settings = Settings(
        bitable_mode="real",
        sqlite_cache_enabled=True,
        sqlite_first_enabled=True,
        bitable_app_token="app_test",
        bitable_table_transactions="tbl_tx",
    )
    client = FakeClient()
    import app.bitable.sqlite_cache as sc
    import app.bitable.bitable_sync as bs

    old_cache = sc._cache_instance
    old_sync = bs._sync_service
    sc._cache_instance = cache
    bs._sync_service = None
    try:
        svc = BitableSyncService(settings, client)  # type: ignore[arg-type]
        rec = await svc.create_local("tbl_tx", {"数量": 1, "交易类型": "in"})
        assert rec["record_id"].startswith("loc_")
        assert cache.outbox_pending_count() == 1
        stats = await svc.process_outbox()
        assert stats["processed"] == 1
        assert cache.outbox_pending_count() == 0
        assert len(client.created) == 1
        bitable_id = client.created[0][0]  # table_id only - get from records
        synced = cache.get_records("tbl_tx")
        assert any(r["record_id"].startswith("rec_sync_") for r in synced)
    finally:
        sc._cache_instance = old_cache
        bs._sync_service = old_sync


@pytest.mark.anyio
async def test_import_from_bitable_skips_pending_rows(tmp_path):
    db = tmp_path / "test2.db"
    cache = SqliteCache(str(db))
    cache.upsert_one(
        "tbl_tx",
        {"record_id": "rec_old", "fields": {"数量": 9}, "created_time": 1000},
        sync_status="pending",
    )
    settings = Settings(bitable_mode="real", sqlite_cache_enabled=True, sqlite_first_enabled=True)
    client = FakeClient()
    import app.bitable.sqlite_cache as sc
    import app.bitable.bitable_sync as bs

    old_cache = sc._cache_instance
    old_sync = bs._sync_service
    sc._cache_instance = cache
    bs._sync_service = None
    try:
        svc = BitableSyncService(settings, client)  # type: ignore[arg-type]
        await svc.import_from_bitable(
            "tbl_tx",
            [{"record_id": "rec_old", "fields": {"数量": 1}, "created_time": 2000}],
        )
        row = cache.get_record("tbl_tx", "rec_old")
        assert row is not None
        assert row["fields"]["数量"] == 9
    finally:
        sc._cache_instance = old_cache
        bs._sync_service = old_sync
