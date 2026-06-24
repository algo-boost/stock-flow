import type { InventoryItem, Location } from "../api/types";

export const GRID_LOCATION_TYPES = new Set(["货柜", "货架", "工具架", "专用螺栓架"]);

export function isGridCapableLocation(location: Location): boolean {
  return Boolean(location.grid_rows) || GRID_LOCATION_TYPES.has(location.type);
}

export function resolveGridSize(
  location: Location,
  inventory: InventoryItem[],
): { rows: number; columns: number | null } {
  const atLoc = inventory.filter((item) => item.location_id === location.id && item.quantity > 0);
  const maxRow = atLoc.reduce((max, item) => Math.max(max, item.row ?? 0), 0);
  const maxCol = atLoc.reduce((max, item) => Math.max(max, item.column ?? 0), 0);
  const hasColumns =
    location.grid_columns != null
    || atLoc.some((item) => item.column != null)
    || location.type.includes("柜");

  const rows = Math.min(Math.max(location.grid_rows ?? maxRow, atLoc.length > 0 ? 1 : 4), 20);
  if (!hasColumns) {
    return { rows: Math.max(rows, maxRow || 4), columns: null };
  }
  const columns = Math.min(Math.max(location.grid_columns ?? (maxCol || 6), 1), 20);
  return { rows: Math.max(rows, maxRow || 1), columns };
}

export interface ShelfCell {
  key: string;
  row: number;
  column: number | null;
  label: string;
  quantity: number;
  items: InventoryItem[];
}

export function buildShelfCells(location: Location, inventory: InventoryItem[]): {
  cells: ShelfCell[];
  unslotted: InventoryItem[];
  previewDistributed: boolean;
} {
  const atLoc = inventory.filter((item) => item.location_id === location.id && item.quantity > 0);
  const { rows, columns } = resolveGridSize(location, atLoc);
  const cells: ShelfCell[] = [];
  const slotted = atLoc.filter((item) => item.row != null);
  let unslotted = atLoc.filter((item) => item.row == null);

  if (columns == null) {
    for (let row = 1; row <= rows; row += 1) {
      const items = atLoc.filter((item) => item.row === row);
      cells.push({
        key: `r${row}`,
        row,
        column: null,
        label: `第 ${row} 层`,
        quantity: items.reduce((sum, item) => sum + item.quantity, 0),
        items,
      });
    }
  } else {
    for (let row = 1; row <= rows; row += 1) {
      for (let column = 1; column <= columns; column += 1) {
        const items = atLoc.filter((item) => item.row === row && item.column === column);
        cells.push({
          key: `r${row}c${column}`,
          row,
          column,
          label: `${row} 层 · ${column} 号`,
          quantity: items.reduce((sum, item) => sum + item.quantity, 0),
          items,
        });
      }
    }
  }

  let previewDistributed = false;
  if (unslotted.length > 0 && slotted.length === 0 && cells.length > 0) {
    previewDistributed = true;
    const distributed = cells.map((cell) => ({ ...cell, items: [] as InventoryItem[], quantity: 0 }));
    let idx = 0;
    for (const cell of distributed) {
      if (idx >= unslotted.length) break;
      cell.items = [unslotted[idx]];
      cell.quantity = unslotted[idx].quantity;
      idx += 1;
    }
    unslotted = unslotted.slice(idx);
    return { cells: distributed, unslotted, previewDistributed };
  }

  return { cells, unslotted, previewDistributed };
}

export function formatLocationPath(locations: Location[], locationId: string | null): string {
  if (!locationId) return "";
  const map = new Map(locations.map((item) => [item.id, item]));
  const parts: string[] = [];
  let current = map.get(locationId);
  while (current) {
    parts.unshift(current.name);
    current = current.parent_id ? map.get(current.parent_id) : undefined;
  }
  return parts.join(" / ");
}
