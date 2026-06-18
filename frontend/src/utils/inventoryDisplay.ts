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
