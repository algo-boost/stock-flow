from __future__ import annotations

from datetime import date, datetime, timezone

from app.models import Transaction, TransactionType
from app.services.pending_returns import compute_pending_returns


def _tx(
    *,
    tx_id: str,
    tx_type: TransactionType,
    material_id: str,
    qty: int,
    operator: str,
    remark: str,
    created_at: datetime,
) -> Transaction:
    return Transaction(
        id=tx_id,
        type=tx_type,
        material_id=material_id,
        material_name="测试物料",
        location_id="loc_01",
        location_name="A-柜-01",
        quantity=qty,
        operator=operator,
        remark=remark,
        created_at=created_at,
    )


def test_pending_return_after_borrow_outbound():
    t0 = datetime(2026, 6, 1, 10, 0, tzinfo=timezone.utc)
    txs = [
        _tx(
            tx_id="tx_out",
            tx_type=TransactionType.OUTBOUND,
            material_id="mat_01",
            qty=-2,
            operator="研发用户",
            remark="项目领用 | 需归还：2026-06-20",
            created_at=t0,
        )
    ]
    pending = compute_pending_returns(txs, today=date(2026, 6, 10))
    assert len(pending) == 1
    assert pending[0].quantity == 2
    assert pending[0].return_due_at == date(2026, 6, 20)
    assert pending[0].overdue is False


def test_pending_return_cleared_by_inbound_return():
    t0 = datetime(2026, 6, 1, 10, 0, tzinfo=timezone.utc)
    t1 = datetime(2026, 6, 15, 10, 0, tzinfo=timezone.utc)
    txs = [
        _tx(
            tx_id="tx_out",
            tx_type=TransactionType.OUTBOUND,
            material_id="mat_01",
            qty=-2,
            operator="研发用户",
            remark="项目领用 | 需归还：2026-06-20",
            created_at=t0,
        ),
        _tx(
            tx_id="tx_in",
            tx_type=TransactionType.INBOUND,
            material_id="mat_01",
            qty=2,
            operator="研发用户",
            remark="项目结束归还",
            created_at=t1,
        ),
    ]
    pending = compute_pending_returns(txs, today=date(2026, 6, 16))
    assert pending == []


def test_pending_return_partial_return():
    t0 = datetime(2026, 6, 1, 10, 0, tzinfo=timezone.utc)
    t1 = datetime(2026, 6, 15, 10, 0, tzinfo=timezone.utc)
    txs = [
        _tx(
            tx_id="tx_out",
            tx_type=TransactionType.OUTBOUND,
            material_id="mat_01",
            qty=-3,
            operator="研发用户",
            remark="领用 | 需归还：2026-06-30",
            created_at=t0,
        ),
        _tx(
            tx_id="tx_in",
            tx_type=TransactionType.INBOUND,
            material_id="mat_01",
            qty=1,
            operator="研发用户",
            remark="先归还 1 个",
            created_at=t1,
        ),
    ]
    pending = compute_pending_returns(txs, today=date(2026, 6, 16))
    assert len(pending) == 1
    assert pending[0].quantity == 2


def test_not_required_outbound_not_listed():
    txs = [
        _tx(
            tx_id="tx_out",
            tx_type=TransactionType.OUTBOUND,
            material_id="mat_01",
            qty=-1,
            operator="研发用户",
            remark="装机交付 | 无须归还",
            created_at=datetime(2026, 6, 1, 10, 0, tzinfo=timezone.utc),
        )
    ]
    assert compute_pending_returns(txs) == []


def test_borrow_detected_when_remark_has_approval_suffix():
    txs = [
        _tx(
            tx_id="tx_out",
            tx_type=TransactionType.OUTBOUND,
            material_id="mat_01",
            qty=-6,
            operator="研发用户",
            remark="测试 | 需归还：2026-06-30；审批人：杨忠银",
            created_at=datetime(2026, 6, 20, 9, 35, tzinfo=timezone.utc),
        )
    ]
    pending = compute_pending_returns(txs, borrower="研发用户", today=date(2026, 6, 20))
    assert len(pending) == 1
    assert pending[0].quantity == 6
    assert pending[0].material_name == "测试物料"


def test_borrow_detected_when_operator_label_before_pipe_metadata():
    txs = [
        _tx(
            tx_id="tx_out",
            tx_type=TransactionType.OUTBOUND,
            material_id="mat_01",
            qty=-3,
            operator="张工",
            remark="测试；操作人: 管理员 | 格位:2:4 | 需归还：2026-07-08",
            created_at=datetime(2026, 7, 7, 11, 18, tzinfo=timezone.utc),
        )
    ]
    pending = compute_pending_returns(txs, today=date(2026, 7, 7))
    assert len(pending) == 1
    assert pending[0].quantity == 3
    assert pending[0].borrower == "张工"
    assert pending[0].return_due_at == date(2026, 7, 8)


def test_return_inbound_with_approval_suffix_only_in_raw_remark():
    t0 = datetime(2026, 6, 20, 9, 0, tzinfo=timezone.utc)
    t1 = datetime(2026, 6, 20, 10, 0, tzinfo=timezone.utc)
    txs = [
        _tx(
            tx_id="tx_out",
            tx_type=TransactionType.OUTBOUND,
            material_id="mat_01",
            qty=-1,
            operator="研发用户",
            remark="借用 | 需归还：2026-06-30；审批人：杨忠银",
            created_at=t0,
        ),
        _tx(
            tx_id="tx_in",
            tx_type=TransactionType.INBOUND,
            material_id="mat_01",
            qty=1,
            operator="研发用户",
            remark="提前归还；审批人：杨忠银",
            created_at=t1,
        ),
    ]
    assert compute_pending_returns(txs) == []


def test_return_inbound_clears_borrow_when_operator_names_differ_by_alias():
    t0 = datetime(2026, 6, 20, 9, 7, tzinfo=timezone.utc)
    t1 = datetime(2026, 6, 20, 10, 7, tzinfo=timezone.utc)
    txs = [
        _tx(
            tx_id="tx_out",
            tx_type=TransactionType.OUTBOUND,
            material_id="mat_motor",
            qty=-1,
            operator="研发用户",
            remark="测试 | 格位:1:2 | 需归还：2026-06-30；申请人: 研发用户；审批人：杨忠银；操作人: 研发用户",
            created_at=t0,
        ),
        _tx(
            tx_id="tx_in",
            tx_type=TransactionType.INBOUND,
            material_id="mat_motor",
            qty=1,
            operator="杨忠银",
            remark="提前归还；审批人：杨忠银；操作人: 研发用户",
            created_at=t1,
        ),
    ]
    assert compute_pending_returns(txs) == []


def test_admin_direct_return_inbound_clears_user_borrow():
    t0 = datetime(2026, 6, 20, 9, 35, tzinfo=timezone.utc)
    t1 = datetime(2026, 6, 21, 10, 33, tzinfo=timezone.utc)
    txs = [
        _tx(
            tx_id="tx_out",
            tx_type=TransactionType.OUTBOUND,
            material_id="mat_foam",
            qty=-3,
            operator="研发用户",
            remark="测试 | 需归还：2026-06-30；申请人: 研发用户；审批人：杨忠银；操作人: 研发用户",
            created_at=t0,
        ),
        _tx(
            tx_id="tx_in",
            tx_type=TransactionType.INBOUND,
            material_id="mat_foam",
            qty=3,
            operator="杨忠银",
            remark="归还",
            created_at=t1,
        ),
    ]
    assert compute_pending_returns(txs) == []
