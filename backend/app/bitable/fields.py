from typing import Any


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


def write_link(record_id: str) -> list[str]:
    return [record_id]


def write_user(open_id: str) -> list[dict[str, str]]:
    return [{"id": open_id}]


def normalize_tx_type(value: Any) -> str:
    raw = (field_text(value) or "").strip().lower()
    if raw in {"in", "入库"}:
        return "入库"
    if raw in {"out", "出库"}:
        return "出库"
    return field_text(value) or raw
