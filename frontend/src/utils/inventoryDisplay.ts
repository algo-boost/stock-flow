import type { InventoryItem } from "../api/types";

export function formatInventorySlot(item: InventoryItem, includeQuantity = true): string {
  const location = item.location_name ?? item.location_id;
  if (item.row != null && item.column != null) {
    const slot = `${item.row}行${item.column}列`;
    return includeQuantity ? `${location} · ${slot} · ${item.quantity}个` : `${location} · ${slot}`;
  }
  return includeQuantity ? `${location} · ${item.quantity}个` : location;
}

export function formatInventorySummary(items: InventoryItem[], limit = 3): string | undefined {
  const parts = items.slice(0, limit).map((item) => formatInventorySlot(item));
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/** 去掉摘要里各库位的数量，避免与右侧总库存徽章重复 */
export function stripQuantitiesFromInventorySummary(summary: string): string {
  const stripLine = (line: string) => {
    const parts = line.split(" · ").map((part) => part.trim()).filter(Boolean);
    const kept: string[] = [];
    for (let i = 0; i < parts.length; ) {
      kept.push(parts[i]);
      i += 1;
      if (i < parts.length && /^\d+行\d+列$/.test(parts[i])) {
        kept.push(parts[i]);
        i += 1;
      }
      if (i < parts.length && /^\d+个$/.test(parts[i])) {
        i += 1;
      }
    }
    return kept.join(" · ");
  };

  return summary
    .split("\n")
    .map(stripLine)
    .filter(Boolean)
    .join(" · ");
}

export function formatCatalogLocationSummary(
  summary: string | null | undefined,
  fallback: string,
): string {
  return summary ? stripQuantitiesFromInventorySummary(summary) : fallback;
}

/** 前端 Selector 用：区分同库位不同格位 */
export function inventorySlotKey(item: Pick<InventoryItem, "location_id" | "row" | "column">): string {
  if (item.row != null && item.column != null) {
    return `${item.location_id}:${item.row}:${item.column}`;
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
    return { location_id: parts[0], row: Number(parts[1]), column: Number(parts[2]) };
  }
  return { location_id: key };
}

export function findInventoryBySlotKey(items: InventoryItem[], key: string): InventoryItem | undefined {
  const parsed = parseInventorySlotKey(key);
  return items.find(
    (item) =>
      item.location_id === parsed.location_id &&
      (parsed.row == null || item.row === parsed.row) &&
      (parsed.column == null || item.column === parsed.column),
  );
}
