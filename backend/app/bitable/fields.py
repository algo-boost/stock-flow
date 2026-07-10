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
    """提取关联记录 ID 列表。仅处理明确的关联格式，不把普通文本误判为 link。"""
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
    # 只有以 "rec" 开头的字符串才可能是 Bitable record_id，普通文本不是
    if isinstance(value, str) and value.startswith("rec"):
        return [value]
    return []


def field_link_id(value: Any) -> str | None:
    ids = field_link_ids(value)
    return ids[0] if ids else None


def field_user_name(value: Any) -> str | None:
    if isinstance(value, list) and value:
        first = value[0]
        if isinstance(first, dict):
            name = first.get("name") or first.get("en_name")
            if name:
                return str(name)
            user_id = first.get("id") or first.get("open_id") or first.get("user_id")
            if user_id and is_feishu_user_id(str(user_id)):
                return None
            return str(user_id) if user_id else None
    text = field_text(value)
    if text and is_feishu_user_id(text):
        return None
    return text


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


def _extract_bitable_text(val: Any) -> str | None:
    """从 Bitable 文本字段格式 [{"text":"..."}] 中提取纯文本。"""
    if isinstance(val, list) and val:
        first = val[0]
        if isinstance(first, dict) and "text" in first:
            return first["text"]
    if isinstance(val, dict) and "text" in val:
        return val["text"]
    return None


def prepare_fields_for_bitable_write(fields: dict[str, Any]) -> dict[str, Any]:
    """将 SQLite 缓存字段转为 Bitable Open API 可写入格式。"""
    out: dict[str, Any] = {}
    for key, val in fields.items():
        if val is None or val == "":
            continue
        # 1. 关联字段
        link_ids = field_link_ids(val)
        if link_ids:
            out[key] = link_ids
            continue
        # 2. 人员字段
        user_id = field_user_id(val)
        if user_id and isinstance(val, (list, dict)):
            out[key] = write_user(user_id)
            continue
        # 3. Bitable 文本格式 [{"text":"..."}] → 提取纯文本
        text_val = _extract_bitable_text(val)
        if text_val is not None:
            out[key] = text_val
            continue
        # 4. 布尔
        if isinstance(val, bool):
            out[key] = val
            continue
        # 5. 数字
        if isinstance(val, (int, float)) and not isinstance(val, bool):
            out[key] = int(val) if isinstance(val, float) and val == int(val) else val
            continue
        # 6. 纯文本字符串
        if isinstance(val, str):
            stripped = val.strip()
            if stripped.replace(".", "", 1).isdigit():
                out[key] = field_number(stripped)
                continue
            out[key] = val
            continue
        # 7. 数字数组
        if isinstance(val, list) and val and isinstance(val[0], (int, float)):
            out[key] = val
            continue
        # 8. 字符串数组 / dict 数组等复杂类型 → 原样传递
        if isinstance(val, (dict, list)):
            out[key] = val
            continue
    return out


def merge_bitable_field_values(existing: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
    """合并 Bitable 字段：避免用写入时的残缺快照覆盖缓存里更完整的值。"""
    merged = dict(incoming)
    for key, old_val in existing.items():
        if old_val is None or old_val == "":
            continue
        new_val = incoming.get(key)
        if new_val is None or new_val == "":
            merged[key] = old_val
            continue
        old_name = field_user_name(old_val)
        new_name = field_user_name(new_val)
        if old_name and not new_name:
            merged[key] = old_val
        elif isinstance(old_val, (int, float)) and not isinstance(new_val, (int, float)):
            merged[key] = old_val
    return merged


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
