from __future__ import annotations

from typing import Any, Optional, Union

from app.models import InventoryItem

InventoryKey2 = tuple[str, str]
InventoryKey4 = tuple[str, str, Optional[int], Optional[int]]
InventoryKey = Union[InventoryKey2, InventoryKey4]


def inv_key(
    material_id: str,
    location_id: str,
    row: Optional[int] = None,
    column: Optional[int] = None,
    *,
    slots_enabled: bool = True,
) -> InventoryKey:
    """库存字典键；未启用格位时仅用 (物料, 库位)。"""
    if slots_enabled:
        return (material_id, location_id, row, column)
    return (material_id, location_id)


def key_material_id(key: InventoryKey) -> str:
    return key[0]


def key_location_id(key: InventoryKey) -> str:
    return key[1]


def key_row(key: InventoryKey) -> Optional[int]:
    return key[2] if len(key) == 4 else None


def key_column(key: InventoryKey) -> Optional[int]:
    return key[3] if len(key) == 4 else None


def resolve_outbound_slot(
    inventory_qty: dict[InventoryKey, int],
    material_id: str,
    location_id: str,
    qty: int,
    row: Optional[int] = None,
    column: Optional[int] = None,
    *,
    slots_enabled: bool,
) -> tuple[Optional[int], Optional[int]]:
    """审批/出库时确定格位：优先指定格位，否则自动选取可用库存。"""
    if not slots_enabled:
        return None, None
    if row is not None and column is not None:
        return row, column
    if row is not None:
        return row, column

    candidates: list[tuple[Optional[int], Optional[int], int]] = []
    for key, quantity in inventory_qty.items():
        if key_material_id(key) != material_id or key_location_id(key) != location_id:
            continue
        if quantity <= 0:
            continue
        candidates.append((key_row(key), key_column(key), quantity))
    if not candidates:
        return row, column

    for r, c, available in candidates:
        if r is None and c is None and available >= qty:
            return None, None

    slotted = sorted(
        [(r, c, available) for r, c, available in candidates if r is not None],
        key=lambda item: (-item[2], item[0] or 0, item[1] or 0),
    )
    for r, c, available in slotted:
        if available >= qty:
            return r, c
    return row, column


def inventory_item_matches_slot(
    item: InventoryItem,
    location_id: str,
    row: Optional[int],
    column: Optional[int],
    *,
    slots_enabled: bool,
) -> bool:
    if item.location_id != location_id:
        return False
    if not slots_enabled:
        return True
    if row is None and column is None:
        return item.row is None and item.column is None
    if column is None:
        return item.row == row and item.column is None
    return item.row == row and item.column == column
