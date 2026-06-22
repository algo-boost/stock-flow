from __future__ import annotations

from datetime import datetime, timezone

from app.bitable.repository import BitableRepository
from app.config import Settings


def test_parse_transaction_created_at_uses_record_created_time():
    repo = BitableRepository(Settings(bitable_mode="real"))
    ts_ms = int(datetime(2026, 6, 20, 9, 30, tzinfo=timezone.utc).timestamp() * 1000)
    rec = {"record_id": "rec_test", "created_time": ts_ms, "fields": {}}
    parsed = repo._parse_transaction_created_at(rec, rec["fields"])
    assert parsed == datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc)


def test_parse_transaction_created_at_prefers_field_over_record_time():
    repo = BitableRepository(Settings(bitable_mode="real", bitable_f_tx_created="创建时间"))
    field_ts = int(datetime(2026, 6, 19, 8, 0, tzinfo=timezone.utc).timestamp() * 1000)
    record_ts = int(datetime(2026, 6, 20, 9, 30, tzinfo=timezone.utc).timestamp() * 1000)
    rec = {
        "record_id": "rec_test",
        "created_time": record_ts,
        "fields": {"创建时间": field_ts},
    }
    parsed = repo._parse_transaction_created_at(rec, rec["fields"])
    assert parsed == datetime.fromtimestamp(field_ts / 1000, tz=timezone.utc)


def test_parse_transaction_created_at_supports_legacy_field_name():
    repo = BitableRepository(Settings(bitable_mode="real", bitable_f_tx_created="missing"))
    field_ts = int(datetime(2026, 6, 18, 12, 0, tzinfo=timezone.utc).timestamp() * 1000)
    rec = {"record_id": "rec_test", "fields": {"交易时间": field_ts}}
    parsed = repo._parse_transaction_created_at(rec, rec["fields"])
    assert parsed == datetime.fromtimestamp(field_ts / 1000, tz=timezone.utc)
