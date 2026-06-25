from __future__ import annotations

from datetime import date, datetime, timezone

from app.models import Transaction, TransactionType
from app.services.pending_returns import compute_pending_returns
from app.utils.disposition_remark import format_disposition_remark, parse_disposition_remark


def test_format_and_parse_disposition_remark():
    remark = format_disposition_remark("已消耗", "tx_out_1", 2, "装机交付")
    parsed = parse_disposition_remark(remark)
    assert parsed == ("已消耗", "tx_out_1", 2, "装机交付")


def test_pending_return_cleared_by_disposition_closure():
    t0 = datetime(2026, 6, 1, 10, 0, tzinfo=timezone.utc)
    t1 = datetime(2026, 6, 5, 10, 0, tzinfo=timezone.utc)
    txs = [
        Transaction(
            id="tx_out",
            type=TransactionType.OUTBOUND,
            material_id="mat_01",
            material_name="电机",
            location_id="loc_01",
            location_name="A柜",
            quantity=-2,
            operator="研发用户",
            remark="项目领用 | 需归还：2026-06-20",
            created_at=t0,
        ),
        Transaction(
            id="tx_close",
            type=TransactionType.OUTBOUND,
            material_id="mat_01",
            material_name="电机",
            location_id="loc_01",
            location_name="A柜",
            quantity=0,
            operator="库管",
            remark=format_disposition_remark("已消耗", "tx_out", 2, "产品交付"),
            created_at=t1,
        ),
    ]
    pending = compute_pending_returns(txs, today=date(2026, 6, 10))
    assert pending == []
