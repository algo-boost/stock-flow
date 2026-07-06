from __future__ import annotations

from app.bitable.fields import merge_bitable_field_values
from app.bitable.repository import BitableRepository
from app.config import Settings


def test_merge_bitable_field_values_keeps_richer_user_and_time():
    existing = {
        "操作人": [{"id": "ou_abc1234567890", "name": "肖方方"}],
        "创建时间": 1782466735000,
    }
    incoming = {
        "操作人": [{"id": "ou_abc1234567890"}],
        "数量": 2,
    }
    merged = merge_bitable_field_values(existing, incoming)
    assert merged["操作人"][0]["name"] == "肖方方"
    assert merged["创建时间"] == 1782466735000
    assert merged["数量"] == 2


def test_normalize_bitable_record_syncs_created_time_column():
    repo = BitableRepository(Settings(bitable_mode="real", bitable_f_tx_created="创建时间"))
    rec = {
        "record_id": "rec_test",
        "fields": {"创建时间": 1782466735000},
    }
    normalized = repo._normalize_bitable_record(rec)
    assert normalized["created_time"] == 1782466735000
