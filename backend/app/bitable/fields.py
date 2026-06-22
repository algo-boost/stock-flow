from __future__ import annotations

import re
from typing import Any

_FEISHU_OPEN_ID = re.compile(r"^ou_[0-9a-zA-Z]{12,}$")
_FEISHU_UNION_ID = re.compile(r"^on_[0-9a-zA-Z]{12,}$")
_PERSON_LABEL_IN_REMARK = re.compile(r"(?:^|；)\s*(申请人|操作人):\s*([^；]+)")


def field_text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, list) and value:
        first = value[0]
        if isinstance(first, dict):
            return first.get("text") or first.get("name")
        return str(first)
    if isinstance(value, dict):
        return value.get("text") or value.get("name")
    return str(value)


def field_number(value: Any) -> int:
    if value is None:
        return 0
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        stripped = value.strip()
        if stripped.isdigit():
            return int(stripped)
        try:
            return int(float(stripped))
        except ValueError:
            return 0
    return 0


def _append_link_ids(ids: list[str], item: Any) -> None:
    if isinstance(item, dict):
        if item.get("record_id"):
            ids.append(str(item["record_id"]))
        record_ids = item.get("record_ids")
        if isinstance(record_ids, list):
            ids.extend(str(rid) for rid in record_ids if rid)
    elif isinstance(item, str) and item:
        ids.append(item)


def field_link_ids(value: Any) -> list[str]:
    if not value:
        return []
    ids: list[str] = []
    if isinstance(value, list):
        for item in value:
            _append_link_ids(ids, item)
        return ids
    if isinstance(value, dict):
        _append_link_ids(ids, value)
        return ids
    if isinstance(value, str):
        return [value]
    return []


def field_link_id(value: Any) -> str | None:
    ids = field_link_ids(value)
    return ids[0] if ids else None


def field_user_name(value: Any) -> str | None:
    if isinstance(value, list) and value:
        first = value[0]
        if isinstance(first, dict):
            return first.get("name") or first.get("en_name") or first.get("id")
    return field_text(value)


def field_user_id(value: Any) -> str | None:
    if isinstance(value, list) and value:
        first = value[0]
        if isinstance(first, dict):
            user_id = first.get("id") or first.get("open_id") or first.get("user_id")
            return str(user_id) if user_id else None
    if isinstance(value, dict):
        user_id = value.get("id") or value.get("open_id") or value.get("user_id")
        return str(user_id) if user_id else None
    return None


def write_link(record_id: str) -> list[str]:
    return [record_id]


def is_feishu_user_id(value: str | None) -> bool:
    if not value:
        return False
    trimmed = value.strip()
    if trimmed.startswith("ou_mock_"):
        return False
    return bool(_FEISHU_OPEN_ID.match(trimmed) or _FEISHU_UNION_ID.match(trimmed))


def write_user(open_id: str) -> list[dict[str, str]]:
    return [{"id": open_id.strip()}]


def extract_person_label_from_remark(remark: str | None, prefix: str) -> str | None:
    """从备注中的「申请人: xxx / 操作人: xxx」解析姓名（Mock 用户无法写入人员字段时的兜底）。"""
    if not remark or not prefix:
        return None
    for match in _PERSON_LABEL_IN_REMARK.finditer(remark):
        if match.group(1) == prefix:
            name = match.group(2).strip()
            return name or None
    return None


def resolve_person_name(
    user_field_value: Any,
    remark: str | None,
    *,
    remark_prefix: str,
    default: str = "未知",
) -> str:
    name = field_user_name(user_field_value)
    if name:
        return name
    fallback = extract_person_label_from_remark(remark, remark_prefix)
    if fallback and fallback != default:
        return fallback
    if remark_prefix == "操作人":
        applicant = extract_person_label_from_remark(remark, "申请人")
        if applicant and applicant != default:
            return applicant
    return default


def append_operator_label(remark: str | None, label: str, *, prefix: str = "操作人") -> str:
    if not label:
        return (remark or "").strip()
    text = (remark or "").strip()
    suffix = f"{prefix}: {label}"
    if suffix in text:
        return text
    return f"{text}；{suffix}" if text else suffix


def normalize_tx_type(value: Any) -> str:
    raw = (field_text(value) or "").strip().lower()
    if raw in {"in", "入库"}:
        return "入库"
    if raw in {"out", "出库"}:
        return "出库"
    if raw in {"transfer", "move", "移动", "调拨"}:
        return "移动"
    return field_text(value) or raw
