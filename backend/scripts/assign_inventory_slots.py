"""为现有库存记录分配格位（行/列），启用格位功能后一次性运行。

用法（backend 目录）：
    python scripts/assign_inventory_slots.py
    python scripts/assign_inventory_slots.py --dry-run
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.bitable.fields import field_link_id, field_number
from app.bitable.repository import BitableRepository
from app.config import get_settings
from app.utils.slot_rules import is_grid_capable_location, location_requires_column_slot


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="仅预览，不写入")
    args = parser.parse_args()

    settings = get_settings()
    if not settings.inventory_slots_enabled:
        print("格位未启用：请先在 .env 配置 BITABLE_F_INVENTORY_ROW / BITABLE_F_INVENTORY_COLUMN")
        return

    repo = BitableRepository(settings)
    s = settings
    locations = await repo._load_locations()
    inv_records = await repo._load_inventory_records()

    slot_counter: dict[str, int] = defaultdict(int)
    updated = 0
    skipped = 0

    for key, rec in inv_records.items():
        fields = rec.get("fields", {})
        mid = field_link_id(fields.get(s.bitable_f_inventory_material))
        lid = field_link_id(fields.get(s.bitable_f_inventory_location))
        qty = field_number(fields.get(s.bitable_f_inventory_quantity))
        if not mid or not lid or qty <= 0:
            continue

        row, col = repo._read_inventory_slot(fields)
        if row is not None:
            skipped += 1
            continue

        loc = locations.get(lid)
        if not loc or not is_grid_capable_location(loc):
            skipped += 1
            continue

        idx = slot_counter[lid]
        slot_counter[lid] += 1

        rows = loc.grid_rows or 4
        cols = loc.grid_columns
        needs_col = location_requires_column_slot(loc)

        if needs_col and cols:
            assign_row = (idx // cols) + 1
            assign_col = (idx % cols) + 1
        else:
            assign_row = min(idx + 1, rows)
            assign_col = None

        record_id = rec.get("record_id", "")
        inv_fields: dict = {
            s.bitable_f_inventory_row: assign_row,
        }
        if assign_col is not None:
            inv_fields[s.bitable_f_inventory_column] = assign_col

        label = f"{assign_row}-{assign_col}" if assign_col else f"第{assign_row}层"
        print(f"  {loc.name} / {mid[:8]}… → {label} (qty={qty})")

        if not args.dry_run:
            await repo._gw_update(s.bitable_table_inventory, record_id, inv_fields)
            repo._upsert_cached_record(
                s.bitable_table_inventory,
                repo._cached_record(record_id, {**fields, **inv_fields}),
            )
            updated += 1

    if not args.dry_run and updated:
        repo._invalidate_table_cache(s.bitable_table_inventory)

    pending = sum(slot_counter.values())
    if args.dry_run:
        print(f"\n预览：将分配 {pending} 条，跳过 {skipped} 条（已有格位或非格位库位）")
    else:
        print(f"\n已分配 {updated} 条，跳过 {skipped} 条（已有格位或非格位库位）")


if __name__ == "__main__":
    asyncio.run(main())
