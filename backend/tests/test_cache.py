from __future__ import annotations

import pytest

from app.bitable.repository import BitableRepository
from app.config import Settings


@pytest.fixture
def anyio_backend():
    return "asyncio"


class FakeBitableClient:
    def __init__(self, records_by_table: dict[str, list[dict]]):
        self.records_by_table = records_by_table
        self.created: list[tuple[str, dict]] = []
        self.updated: list[tuple[str, str, dict]] = []
        self.deleted: list[tuple[str, str]] = []

    async def list_records(self, table_id: str, page_size: int = 500, *, retries: int = 3):
        return list(self.records_by_table.get(table_id, []))

    async def create_record(self, table_id: str, fields: dict, *, user_id_type: str = "open_id"):
        self.created.append((table_id, fields))
        return {"record_id": f"rec_new_{len(self.created)}", "fields": fields}

    async def update_record(
        self,
        table_id: str,
        record_id: str,
        fields: dict,
        *,
        user_id_type: str = "open_id",
    ):
        self.updated.append((table_id, record_id, fields))
        return {"record_id": record_id, "fields": fields}

    async def delete_record(self, table_id: str, record_id: str) -> None:
        self.deleted.append((table_id, record_id))


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


@pytest.mark.anyio
async def test_bitable_categories_read_parent_and_create_child():
    settings = Settings(
        bitable_mode="real",
        bitable_app_token="app_test",
        bitable_table_categories="tbl_categories",
    )
    repo = BitableRepository(settings)
    fake_client = FakeBitableClient(
        {
            "tbl_categories": [
                {"record_id": "rec_root", "fields": {"分类名称": "电机模组"}},
                {
                    "record_id": "rec_child",
                    "fields": {
                        "分类名称": "达妙电机",
                        "父分类ID": [{"record_ids": ["rec_root"], "text": "电机模组"}],
                    },
                },
            ]
        }
    )
    repo.client = fake_client

    categories = await repo.list_categories()
    child = next(category for category in categories if category.id == "rec_child")
    assert child.parent_id == "rec_root"
    assert child.major_name == "电机模组"
    assert child.sub_name == "达妙电机"

    created = await repo.create_category(type("Payload", (), {
        "name": "鸣志电机",
        "parent_id": "rec_root",
        "default_location_type": "货柜",
        "examples": None,
    })())

    assert created.parent_id == "rec_root"
    assert fake_client.created[0][1]["父分类ID"] == ["rec_root"]
    assert fake_client.created[0][1]["大类"] == "电机模组"
    assert fake_client.created[0][1]["子类"] == "鸣志电机"


@pytest.mark.anyio
async def test_bitable_delete_child_category_reassigns_material_to_parent():
    settings = Settings(
        bitable_mode="real",
        bitable_app_token="app_test_delete",
        bitable_table_categories="tbl_categories",
        bitable_table_materials="tbl_materials",
        bitable_table_locations="tbl_locations",
    )
    repo = BitableRepository(settings)
    fake_client = FakeBitableClient(
        {
            "tbl_categories": [
                {"record_id": "rec_root", "fields": {"分类名称": "电机模组"}},
                {
                    "record_id": "rec_child",
                    "fields": {
                        "分类名称": "达妙电机",
                        "父分类ID": [{"record_ids": ["rec_root"], "text": "电机模组"}],
                    },
                },
            ],
            "tbl_materials": [
                {
                    "record_id": "mat_1",
                    "fields": {
                        "物料编码": "M-001",
                        "物料名称": "达妙 DM4310",
                        "分类ID": [{"record_ids": ["rec_child"], "text": "达妙电机"}],
                        "单位": "个",
                    },
                }
            ],
        }
    )
    repo.client = fake_client

    await repo.delete_category("rec_child")

    assert fake_client.updated[0] == (
        "tbl_materials",
        "mat_1",
        {"分类ID": ["rec_root"], "大类": "电机模组", "子类": "电机模组"},
    )
    assert fake_client.deleted == [("tbl_categories", "rec_child")]
