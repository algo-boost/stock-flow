from __future__ import annotations

import re

_DISPOSITION_PREFIX = re.compile(
    r"^结案\|(已消耗|已丢失|已报废)\|关联=([^|]+)\|数量=(\d+)(?:\|说明=(.*))?$"
)


def format_disposition_remark(
    disposition_type: str,
    source_tx_id: str,
    quantity: int,
    note: str | None = None,
) -> str:
    base = f"结案|{disposition_type}|关联={source_tx_id}|数量={quantity}"
    text = (note or "").strip()
    if text:
        return f"{base}|说明={text}"
    return base


def parse_disposition_remark(remark: str | None) -> tuple[str, str, int, str | None] | None:
    """解析结案流水备注，返回 (处置类型, 源借出流水ID, 数量, 说明)。"""
    text = (remark or "").strip()
    match = _DISPOSITION_PREFIX.match(text)
    if not match:
        return None
    disposition_type, source_tx_id, qty_raw, note = match.groups()
    return disposition_type, source_tx_id.strip(), int(qty_raw), (note or None)


def is_disposition_remark(remark: str | None) -> bool:
    return parse_disposition_remark(remark) is not None
