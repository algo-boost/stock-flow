from datetime import date

from app.models import StockRequestCreate, StockRequestType
from app.utils.request_remark import format_outbound_remark, format_request_remark, parse_request_remark


def test_format_outbound_remark_not_required():
    encoded = format_outbound_remark("交付客户", return_required=False)
    remark, row, column, return_required, return_due_at = parse_request_remark(encoded)
    assert remark == "交付客户"
    assert return_required is False
    assert row is None
    assert return_due_at is None


def test_format_and_parse_request_remark_with_slot_and_return():
    payload = StockRequestCreate(
        type=StockRequestType.OUTBOUND,
        material_id="mat_001",
        location_id="loc_01",
        qty=1,
        idempotency_key="test-remark-001",
        note="实验",
        return_required=True,
        return_due_at=date(2026, 6, 30),
        row=1,
        column=6,
    )
    encoded = format_request_remark(payload)
    remark, row, column, return_required, return_due_at = parse_request_remark(encoded)
    assert remark == "实验"
    assert row == 1
    assert column == 6
    assert return_required is True
    assert return_due_at == date(2026, 6, 30)


def test_parse_request_remark_not_required():
    remark, row, column, return_required, return_due_at = parse_request_remark("领用 | 无须归还")
    assert remark == "领用"
    assert return_required is False
    assert row is None
    assert return_due_at is None


def test_parse_request_remark_with_approval_suffix():
    remark, row, column, return_required, return_due_at = parse_request_remark(
        "测试 | 需归还：2026-06-30；审批人：杨忠银"
    )
    assert remark == "测试"
    assert return_required is True
    assert return_due_at == date(2026, 6, 30)
