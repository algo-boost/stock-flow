from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import date, datetime, timezone

from app.models import PendingReturn, Transaction, TransactionType
from app.bitable.fields import extract_person_label_from_remark
from app.utils.disposition_remark import is_disposition_remark, parse_disposition_remark
from app.utils.request_remark import parse_request_remark


def _person_aliases(operator: str, remark: str | None) -> set[str]:
    aliases = {operator}
    if remark:
        for prefix in ("操作人", "申请人"):
            label = extract_person_label_from_remark(remark, prefix)
            if label:
                aliases.add(label)
    return aliases


def _person_matches(expected: str, operator: str, remark: str | None) -> bool:
    return expected in _person_aliases(operator, remark)


def _is_borrow_outbound(remark: str | None) -> bool:
    _, _, _, return_required, _ = parse_request_remark(remark)
    return return_required is True


def _is_return_inbound(remark: str | None) -> bool:
    note, _, _, return_required, _ = parse_request_remark(remark)
    if note:
        if "无须归还" in note:
            return False
        if "归还" in note:
            return True
    raw = (remark or "").strip()
    if "无须归还" in raw or "需归还" in raw:
        return False
    return raw in {"归还", "已归还"} or raw.startswith("归还") or raw.endswith("归还")


def _find_return_bucket(
    buckets: dict[tuple[str, str], _BorrowBucket],
    tx: Transaction,
) -> _BorrowBucket | None:
    exact = buckets.get((tx.material_id, tx.operator))
    if exact and exact.lines:
        return exact
    inbound_aliases = _person_aliases(tx.operator, tx.remark)
    matched: list[tuple[tuple[str, str], _BorrowBucket]] = []
    for key, bucket in buckets.items():
        if key[0] != tx.material_id or not bucket.lines:
            continue
        borrow_aliases = _person_aliases(key[1], bucket.lines[0].tx.remark)
        if inbound_aliases & borrow_aliases:
            matched.append((key, bucket))
    if len(matched) == 1:
        return matched[0][1]
    if matched:
        matched.sort(key=lambda item: item[1].lines[0].tx.created_at)
        return matched[0][1]

    # 库管/管理员代还：入库操作人可与借用人不同，按同物料最早借出 FIFO 核销
    candidates = [
        (key, bucket)
        for key, bucket in buckets.items()
        if key[0] == tx.material_id and bucket.lines
    ]
    if not candidates:
        return None
    candidates.sort(key=lambda item: item[1].lines[0].tx.created_at)
    return candidates[0][1]


@dataclass
class _BorrowLine:
    tx: Transaction
    quantity: int
    note: str | None
    return_due_at: date | None


@dataclass
class _BorrowBucket:
    lines: deque[_BorrowLine] = field(default_factory=deque)


def _apply_disposition_to_buckets(
    buckets: dict[tuple[str, str], _BorrowBucket],
    source_tx_id: str,
    quantity: int,
) -> None:
    for bucket in buckets.values():
        for index, line in enumerate(bucket.lines):
            if line.tx.id != source_tx_id:
                continue
            if line.quantity <= quantity:
                bucket.lines.remove(line)
            else:
                line.quantity -= quantity
            return


def compute_pending_returns(
    transactions: list[Transaction],
    *,
    borrower: str | None = None,
    today: date | None = None,
) -> list[PendingReturn]:
    """从流水推导待归还：出库「需归还」扣减后续同物料+借用人且备注含「归还」的入库。"""
    ref_day = today or datetime.now(timezone.utc).date()
    buckets: dict[tuple[str, str], _BorrowBucket] = defaultdict(_BorrowBucket)

    for tx in sorted(transactions, key=lambda item: item.created_at):
        if tx.type == TransactionType.OUTBOUND and is_disposition_remark(tx.remark):
            parsed = parse_disposition_remark(tx.remark)
            if parsed:
                _, source_tx_id, close_qty, _ = parsed
                _apply_disposition_to_buckets(buckets, source_tx_id, close_qty)
            continue

        if tx.type == TransactionType.INBOUND and _is_return_inbound(tx.remark):
            remaining = tx.quantity
            bucket = _find_return_bucket(buckets, tx)
            if not bucket or not bucket.lines:
                continue
            while remaining > 0 and bucket.lines:
                head = bucket.lines[0]
                if head.quantity <= remaining:
                    remaining -= head.quantity
                    bucket.lines.popleft()
                else:
                    head.quantity -= remaining
                    remaining = 0
            continue

        if tx.type != TransactionType.OUTBOUND or not _is_borrow_outbound(tx.remark):
            continue

        note, _, _, _, return_due_at = parse_request_remark(tx.remark)
        qty = abs(tx.quantity)
        if qty <= 0:
            continue
        if borrower and not _person_matches(borrower, tx.operator, tx.remark):
            continue
        buckets[(tx.material_id, tx.operator)].lines.append(
            _BorrowLine(
                tx=tx,
                quantity=qty,
                note=note,
                return_due_at=return_due_at,
            )
        )

    pending: list[PendingReturn] = []
    for bucket in buckets.values():
        for line in bucket.lines:
            if line.quantity <= 0:
                continue
            tx = line.tx
            overdue = bool(line.return_due_at and line.return_due_at < ref_day)
            pending.append(
                PendingReturn(
                    source_tx_id=tx.id,
                    material_id=tx.material_id,
                    material_name=tx.material_name,
                    location_id=tx.location_id,
                    location_name=tx.location_name,
                    quantity=line.quantity,
                    borrower=tx.operator,
                    borrowed_at=tx.created_at,
                    return_due_at=line.return_due_at,
                    note=line.note,
                    overdue=overdue,
                )
            )

    pending.sort(
        key=lambda item: (
            0 if item.overdue else 1,
            item.return_due_at or date.max,
            -item.borrowed_at.timestamp(),
        )
    )
    return pending
