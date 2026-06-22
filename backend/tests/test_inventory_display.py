from __future__ import annotations

from app.models import InventoryItem
from app.utils.inventory_display import format_inventory_slot, format_inventory_summary


def test_format_inventory_slot_with_cabinet_position():
    item = InventoryItem(
        material_id="mat_1",
        location_id="loc_1",
        location_name="电器类A-柜-01",
        row=1,
        column=3,
        quantity=7,
    )
    assert format_inventory_slot(item) == "电器类A-柜-01 · 1行3列 · 7个"


def test_format_inventory_summary_joins_multiple_slots():
    items = [
        InventoryItem(
            material_id="mat_1",
            location_id="loc_1",
            location_name="电器类A-柜-01",
            row=1,
            column=1,
            quantity=7,
        ),
        InventoryItem(
            material_id="mat_1",
            location_id="loc_1",
            location_name="电器类A-柜-01",
            row=1,
            column=3,
            quantity=4,
        ),
    ]
    summary = format_inventory_summary(items)
    assert summary == "电器类A-柜-01 · 1行1列 · 7个 · 电器类A-柜-01 · 1行3列 · 4个"
