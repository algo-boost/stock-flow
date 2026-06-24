import { describe, expect, it } from "vitest";
import type { InventoryItem } from "../api/types";
import {
  findInventoryBySlotKey,
  formatInventorySlot,
  formatInventorySummary,
  inventorySlotKey,
  parseInventorySlotKey,
} from "./inventoryDisplay";

const item: InventoryItem = {
  material_id: "mat_001",
  location_id: "loc_01",
  location_name: "A柜",
  quantity: 5,
  row: 1,
  column: 2,
};

describe("inventoryDisplay", () => {
  it("formatInventorySlot 含格位与数量", () => {
    expect(formatInventorySlot(item)).toBe("A柜 · 1行2列 · 5个");
    expect(formatInventorySlot(item, false)).toBe("A柜 · 1行2列");
  });

  it("formatInventorySummary 限制条数", () => {
    const summary = formatInventorySummary([item, { ...item, row: 2, column: 3 }], 1);
    expect(summary).toBe("A柜 · 1行2列 · 5个");
  });

  it("inventorySlotKey / parseInventorySlotKey 往返", () => {
    const key = inventorySlotKey(item);
    expect(key).toBe("loc_01:1:2");
    expect(parseInventorySlotKey(key)).toEqual({ location_id: "loc_01", row: 1, column: 2 });
  });

  it("findInventoryBySlotKey 定位格位库存", () => {
    const found = findInventoryBySlotKey([item], "loc_01:1:2");
    expect(found?.quantity).toBe(5);
  });
});
