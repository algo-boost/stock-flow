from __future__ import annotations

from app.models import Location

GRID_LOCATION_TYPES = frozenset({"货柜", "货架", "工具架", "专用螺栓架"})


def is_grid_capable_location(location: Location) -> bool:
    return bool(location.grid_rows) or location.type in GRID_LOCATION_TYPES


def location_requires_column_slot(location: Location) -> bool:
    if location.grid_columns is not None:
        return True
    return "柜" in (location.type or "")


def validate_and_normalize_slot(
    location: Location | None,
    row: int | None,
    column: int | None,
    *,
    slots_enabled: bool = True,
) -> tuple[int | None, int | None]:
    """校验并规范化格位：货柜需行+列，货架仅需行号。"""
    if not slots_enabled:
        return None, None
    if row is None and column is None:
        return None, None
    if location is None or not is_grid_capable_location(location):
        return None, None
    if column is not None and row is None:
        raise ValueError("slot_incomplete")
    if location_requires_column_slot(location):
        if row is None or column is None:
            raise ValueError("slot_incomplete")
        return row, column
    if row is None:
        raise ValueError("slot_row_required")
    return row, None


def validate_transfer_slots(
    from_location: Location | None,
    to_location: Location | None,
    from_row: int | None,
    from_column: int | None,
    to_row: int | None,
    to_column: int | None,
    *,
    slots_enabled: bool = True,
) -> tuple[int | None, int | None, int | None, int | None]:
    if not slots_enabled:
        return from_row, from_column, to_row, to_column
    norm_from = validate_and_normalize_slot(from_location, from_row, from_column, slots_enabled=slots_enabled)
    norm_to = validate_and_normalize_slot(to_location, to_row, to_column, slots_enabled=slots_enabled)
    return (*norm_from, *norm_to)
