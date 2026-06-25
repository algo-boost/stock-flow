import type { InventoryItem } from "../api/types";

export function formatInventorySlot(item: InventoryItem, includeQuantity = true): string {
  const location = item.location_name ?? item.location_id;
  if (item.row != null && item.column != null) {
    const slot = `${item.row}行${item.column}列`;
    return includeQuantity ? `${location} · ${slot} · ${item.quantity}个` : `${location} · ${slot}`;
  }
  if (item.row != null) {
    const slot = `第${item.row}层`;
    return includeQuantity ? `${location} · ${slot} · ${item.quantity}个` : `${location} · ${slot}`;
  }
  return includeQuantity ? `${location} · ${item.quantity}个` : location;
}

/** 暂存上架：库位 + 格位（不重复数量） */
export function formatStagingLocationLine(
  item: Pick<InventoryItem, "location_name" | "location_id" | "row" | "column">,
): string {
  const loc = item.location_name ?? item.location_id;
  if (item.row != null && item.column != null) return `${loc} · ${item.row} 层 ${item.column} 列`;
  if (item.row != null) return `${loc} · ${item.row} 层`;
  return loc;
}

/** 详情页「本物料在这里」文案 */
export function formatMaterialSlotPin(item: InventoryItem): {
  headline: string;
  detail: string;
  hasSlot: boolean;
} {
  if (item.row != null && item.column != null) {
    return {
      hasSlot: true,
      headline: `${item.row} 层 ${item.column} 列`,
      detail: `共 ${item.quantity} 件`,
    };
  }
  if (item.row != null) {
    return {
      hasSlot: true,
      headline: `${item.row} 层`,
      detail: `共 ${item.quantity} 件`,
    };
  }
  return {
    hasSlot: false,
    headline: "未标注",
    detail: `共 ${item.quantity} 件`,
  };
}

export function formatInventorySummary(items: InventoryItem[], limit = 3): string | undefined {
  const parts = items.slice(0, limit).map((item) => formatInventorySlot(item));
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/** 前端 Selector 用：区分同库位不同格位 */
export function inventorySlotKey(item: Pick<InventoryItem, "location_id" | "row" | "column">): string {
  if (item.row != null) {
    if (item.column != null) {
      return `${item.location_id}:${item.row}:${item.column}`;
    }
    return `${item.location_id}:${item.row}`;
  }
  return item.location_id;
}

export function parseInventorySlotKey(key: string): {
  location_id: string;
  row?: number;
  column?: number;
} {
  const parts = key.split(":");
  if (parts.length === 3) {
    const row = Number(parts[1]);
    const column = Number(parts[2]);
    return {
      location_id: parts[0],
      row: Number.isFinite(row) ? row : undefined,
      column: Number.isFinite(column) ? column : undefined,
    };
  }
  if (parts.length === 2) {
    const row = Number(parts[1]);
    return {
      location_id: parts[0],
      row: Number.isFinite(row) ? row : undefined,
    };
  }
  return { location_id: key };
}

export function findInventoryBySlotKey(items: InventoryItem[], key: string): InventoryItem | undefined {
  const parsed = parseInventorySlotKey(key);
  return items.find((item) => {
    if (item.location_id !== parsed.location_id) return false;
    if (parsed.row != null && item.row !== parsed.row) return false;
    if (parsed.column != null) {
      return item.column === parsed.column;
    }
    if (parsed.row != null) {
      return item.column == null;
    }
    return item.row == null && item.column == null;
  });
}
