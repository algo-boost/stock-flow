from __future__ import annotations

from app.models import InventoryItem


def format_inventory_slot(item: InventoryItem, *, include_quantity: bool = True) -> str:
    location = item.location_name or item.location_id
    if item.row is not None and item.column is not None:
        slot = f"{item.row}行{item.column}列"
        if include_quantity:
            return f"{location} · {slot} · {item.quantity}个"
        return f"{location} · {slot}"
    if include_quantity:
        return f"{location} · {item.quantity}个"
    return location


def format_inventory_summary(items: list[InventoryItem], limit: int = 3) -> str | None:
    parts = [format_inventory_slot(item) for item in items[:limit]]
    return " · ".join(parts) if parts else None
