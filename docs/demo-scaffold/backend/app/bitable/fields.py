"""Bitable 字段解析 —— link/用户/数字字段必须用专用函数"""
from __future__ import annotations
from typing import Any


def field_text(value: Any) -> str:
    """文本/单选字段 → str"""
    if value is None:
        return ""
    if isinstance(value, list):
        return str(value[0]) if value else ""
    return str(value)


def field_number(value: Any) -> int:
    """数字字段 → int，空值→0"""
    if value is None:
        return 0
    try:
        return int(value)
    except (ValueError, TypeError):
        return 0


def field_link_id(value: Any) -> str:
    """链接字段 → 第一个关联记录 ID
    Bitable link 格式: {"record_ids": ["rec_xxx", "rec_yyy"]}
    """
    if value is None:
        return ""
    if isinstance(value, dict):
        ids = value.get("record_ids") or []
        return str(ids[0]) if ids else ""
    if isinstance(value, list):
        return str(value[0]) if value else ""
    return str(value)


def field_user_name(value: Any) -> str:
    """用户字段 → 用户名
    Bitable user 格式: [{"id":"ou_xxx","name":"张三"}]
    """
    if value is None:
        return ""
    if isinstance(value, list) and len(value) > 0:
        first = value[0]
        if isinstance(first, dict):
            return str(first.get("name") or first.get("id", ""))
        return str(first)
    return str(value)


def field_user_id(value: Any) -> str:
    """用户字段 → 用户 open_id"""
    if value is None:
        return ""
    if isinstance(value, list) and len(value) > 0:
        first = value[0]
        if isinstance(first, dict):
            return str(first.get("id", ""))
        return str(first)
    return str(value)
