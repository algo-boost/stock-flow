from __future__ import annotations

import re
from datetime import date

from app.models import StockRequestCreate, StockRequestType

_SLOT_SUFFIX = re.compile(r"\s*\|\s*格位:(\d+):(\d+)\s*$")
_RETURN_REQUIRED = re.compile(r"\s*\|\s*需归还：(\d{4}-\d{2}-\d{2})\s*$")
_RETURN_REQUIRED_NO_DATE = re.compile(r"\s*\|\s*需归还\s*$")
_RETURN_NOT_REQUIRED = re.compile(r"\s*\|\s*无须归还\s*$")
_SYSTEM_LABEL_TAIL = re.compile(r"(?:；|^)\s*(?:审批人|操作人|申请人)\s*[:：]\s*[^；|]+$")
_INLINE_SYSTEM_LABEL = re.compile(r"(?:；|^)\s*(?:审批人|操作人|申请人)\s*[:：]\s*[^；|]+")


def _strip_system_labels(text: str) -> str:
    while True:
        next_text = _SYSTEM_LABEL_TAIL.sub("", text).strip()
        if next_text == text:
            return text
        text = next_text


def _clean_user_note(text: str) -> str:
    cleaned = _INLINE_SYSTEM_LABEL.sub("", text).strip("； ").strip()
    return cleaned

def format_outbound_remark(
    note: str | None,
    *,
    return_required: bool,
    return_due_at: date | None = None,
    row: int | None = None,
    column: int | None = None,
) -> str:
    parts: list[str] = []
    text = (note or "").strip()
    if text:
        parts.append(text)
    if row is not None and column is not None:
        parts.append(f"格位:{row}:{column}")
    if return_required:
        due = return_due_at.isoformat() if return_due_at else ""
        parts.append(f"需归还：{due}".rstrip("："))
    else:
        parts.append("无须归还")
    return " | ".join(parts)


def format_approved_outbound_remark(
    note: str | None,
    *,
    return_required: bool | None,
    return_due_at: date | None = None,
    row: int | None = None,
    column: int | None = None,
    approver_name: str,
) -> str:
    """审批通过出库时写入流水的备注，含归还计划供待归还推导。"""
    parts: list[str] = []
    text = (note or "").strip()
    if text:
        parts.append(text)
    if row is not None and column is not None:
        parts.append(f"格位:{row}:{column}")
    if return_required is True:
        due = return_due_at.isoformat() if return_due_at else ""
        parts.append(f"需归还：{due}".rstrip("："))
    elif return_required is False:
        parts.append("无须归还")
    body = " | ".join(parts)
    if body:
        return f"{body}；审批人：{approver_name}"
    return f"审批人：{approver_name}"


def format_request_remark(payload: StockRequestCreate) -> str:
    parts: list[str] = []
    text = (payload.note or "").strip()
    if text:
        parts.append(text)
    if payload.row is not None and payload.column is not None:
        parts.append(f"格位:{payload.row}:{payload.column}")
    if payload.type != StockRequestType.OUTBOUND or payload.return_required is None:
        return " | ".join(parts)
    if payload.return_required:
        due = payload.return_due_at.isoformat() if payload.return_due_at else ""
        parts.append(f"需归还：{due}".rstrip("："))
    else:
        parts.append("无须归还")
    return " | ".join(parts)


def parse_request_remark(remark: str | None) -> tuple[str | None, int | None, int | None, bool | None, date | None]:
    """从申请说明解析展示用备注、格位与归还计划（real 模式无独立字段时使用）。"""
    text = _strip_system_labels((remark or "").strip())
    row: int | None = None
    column: int | None = None
    return_required: bool | None = None
    return_due_at: date | None = None

    while text:
        changed = False
        slot_match = _SLOT_SUFFIX.search(text)
        if slot_match and slot_match.end() == len(text):
            row = int(slot_match.group(1))
            column = int(slot_match.group(2))
            text = text[: slot_match.start()].strip()
            changed = True
            continue
        no_return = _RETURN_NOT_REQUIRED.search(text)
        if no_return and no_return.end() == len(text):
            return_required = False
            text = _RETURN_NOT_REQUIRED.sub("", text).strip()
            changed = True
            continue
        due_match = _RETURN_REQUIRED.search(text)
        if due_match and due_match.end() == len(text):
            return_required = True
            return_due_at = date.fromisoformat(due_match.group(1))
            text = _RETURN_REQUIRED.sub("", text).strip()
            changed = True
            continue
        no_date = _RETURN_REQUIRED_NO_DATE.search(text)
        if no_date and no_date.end() == len(text):
            return_required = True
            text = _RETURN_REQUIRED_NO_DATE.sub("", text).strip()
            changed = True
            continue
        if not changed:
            break

    return _clean_user_note(text) or None, row, column, return_required, return_due_at
