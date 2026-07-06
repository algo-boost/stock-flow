import type { InventoryItem, Location } from "../api/types";

export const GRID_LOCATION_TYPES = new Set(["货柜", "货架", "工具架", "专用螺栓架"]);

export function isGridCapableLocation(location: Location): boolean {
  return Boolean(location.grid_rows) || GRID_LOCATION_TYPES.has(location.type);
}

const GRID_SIZE_MAX = 99;

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

  const configuredRows = location.grid_rows;
  const configuredCols = location.grid_columns;

  let rows: number;
  if (configuredRows != null) {
    rows = Math.min(Math.max(configuredRows, maxRow), GRID_SIZE_MAX);
  } else if (atLoc.length > 0) {
    rows = Math.min(Math.max(maxRow, 1), GRID_SIZE_MAX);
  } else {
    rows = Math.min(Math.max(4, maxRow), GRID_SIZE_MAX);
  }

  if (!hasColumns) {
    return { rows, columns: null };
  }

  const columns =
    configuredCols != null
      ? Math.min(Math.max(configuredCols, maxCol), GRID_SIZE_MAX)
      : Math.min(Math.max(maxCol || 6, 1), GRID_SIZE_MAX);
  return { rows, columns };
}

export interface ShelfCell {
  key: string;
  row: number;
  column: number | null;
  label: string;
  quantity: number;
  items: InventoryItem[];
  previewOnly?: boolean;
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
      cell.previewOnly = true;
      idx += 1;
    }
    unslotted = unslotted.slice(idx);
    return { cells: distributed, unslotted, previewDistributed };
  }

  return { cells, unslotted, previewDistributed };
}

export function cellMaterialQty(cell: ShelfCell, materialId?: string): number {
  if (!materialId) return 0;
  return cell.items
    .filter((item) => item.material_id === materialId)
    .reduce((sum, item) => sum + item.quantity, 0);
}

export function cellHasMaterial(cell: ShelfCell, materialId?: string): boolean {
  return cellMaterialQty(cell, materialId) > 0;
}
