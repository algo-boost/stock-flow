from __future__ import annotations

from app.models import Location


def is_staging_location(location: Location) -> bool:
    """判断是否为快递/到货暂存库位。"""
    type_text = (location.type or "").strip()
    name_text = (location.name or "").strip()
    major_text = (location.major_name or "").strip()
    return "暂存" in type_text or "暂存" in name_text or "暂存" in major_text
