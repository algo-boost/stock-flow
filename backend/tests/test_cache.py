from __future__ import annotations

import pytest

from app.bitable.repository import BitableRepository
from app.config import Settings


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_refresh_tables_best_effort_keeps_partial_failures(monkeypatch):
    settings = Settings(
        bitable_mode="real",
        bitable_app_token="app_test",
        bitable_table_materials="tbl_ok",
        bitable_table_inventory="tbl_failed",
    )
    repo = BitableRepository(settings)

    async def fake_refresh_table_cache(table_id: str, *, force: bool, retries: int = 3):
        if table_id == "tbl_failed":
            raise RuntimeError("Data not ready, please try again later")
        return [{"record_id": "rec_ok", "fields": {}}]

    monkeypatch.setattr(repo, "_refresh_table_cache", fake_refresh_table_cache)

    result = await repo._refresh_tables_best_effort(["tbl_ok", "tbl_failed"], force=True)

    assert result["tbl_ok"] is None
    assert result["tbl_failed"] == "Data not ready, please try again later"
