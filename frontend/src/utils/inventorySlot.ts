import type { InventoryItem, Location } from "../api/types";
import { buildShelfCells, isGridCapableLocation, resolveGridSize } from "./shelfGrid";

export interface SlotSelection {
  row: number | null;
  column: number | null;
  label?: string;
}

export function slotSelectionLabel(row: number | null, column: number | null): string {
  if (row == null || row < 1) return "未选择";
  if (column != null && column > 0) return `${row} 层 · ${column} 号格`;
  return `第 ${row} 层`;
}

export function isSlotSelected(
  cell: { row: number; column: number | null },
  selected: SlotSelection | null | undefined,
): boolean {
  if (!selected || selected.row == null) return false;
  if (cell.row !== selected.row) return false;
  if (selected.column == null) return cell.column == null;
  return cell.column === selected.column;
}

/** 入库/移动提交用的 row/column（非格位库位不传） */
export function buildSlotPayload(
  location: Location | undefined,
  inventory: InventoryItem[],
  selection: SlotSelection,
): { row?: number; column?: number } {
  if (!location || !isGridCapableLocation(location)) return {};
  const { columns } = resolveGridSize(location, inventory);
  if (selection.row == null || selection.row < 1) return {};
  if (columns != null) {
    if (selection.column == null || selection.column < 1) return {};
    return { row: selection.row, column: selection.column };
  }
  return { row: selection.row };
}

export function suggestDefaultSlot(
  location: Location,
  inventory: InventoryItem[],
  materialId?: string,
): SlotSelection {
  const atLoc = inventory.filter((item) => item.location_id === location.id);
  const { columns } = resolveGridSize(location, atLoc);

  if (materialId) {
    const existing = atLoc.find(
      (item) => item.material_id === materialId && item.row != null && item.quantity > 0,
    );
    if (existing?.row) {
      return {
        row: existing.row,
        column: existing.column ?? null,
        label: slotSelectionLabel(existing.row, existing.column ?? null),
      };
    }
  }

  const { cells } = buildShelfCells(location, atLoc);

  const empty = cells.find((cell) => cell.quantity <= 0);
  if (empty) {
    return {
      row: empty.row,
      column: empty.column,
      label: empty.label,
    };
  }

  if (columns != null) {
    return { row: 1, column: 1, label: slotSelectionLabel(1, 1) };
  }
  return { row: 1, column: null, label: slotSelectionLabel(1, null) };
}

export function isSlotReady(
  location: Location | undefined,
  inventory: InventoryItem[],
  selection: SlotSelection,
): boolean {
  return Object.keys(buildSlotPayload(location, inventory, selection)).length > 0
    || !location
    || !isGridCapableLocation(location);
}
