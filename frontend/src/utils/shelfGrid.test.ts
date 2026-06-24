import { describe, expect, it } from "vitest";
import type { InventoryItem, Location } from "../api/types";
import { buildShelfCells, formatLocationPath, isGridCapableLocation, resolveGridSize } from "./shelfGrid";

const cabinet: Location = {
  id: "loc_01",
  code: "A-01",
  name: "A柜",
  type: "货柜",
  grid_rows: 2,
  grid_columns: 3,
};

const shelf: Location = {
  id: "loc_02",
  code: "B-01",
  name: "B架",
  type: "货架",
  grid_rows: 3,
  grid_columns: null,
};

describe("shelfGrid", () => {
  it("isGridCapableLocation 识别货柜/货架", () => {
    expect(isGridCapableLocation(cabinet)).toBe(true);
    expect(isGridCapableLocation({ ...shelf, grid_rows: null, type: "区域" })).toBe(false);
  });

  it("resolveGridSize 空柜默认至少 4 层", () => {
    const size = resolveGridSize(cabinet, []);
    expect(size.rows).toBe(4);
    expect(size.columns).toBe(3);
  });

  it("buildShelfCells 生成格位矩阵", () => {
    const inventory: InventoryItem[] = [
      {
        material_id: "mat_001",
        location_id: "loc_01",
        location_name: "A柜",
        quantity: 2,
        row: 1,
        column: 2,
      },
    ];
    const { cells } = buildShelfCells(cabinet, inventory);
    expect(cells.length).toBe(6);
    const occupied = cells.find((c) => c.row === 1 && c.column === 2);
    expect(occupied?.quantity).toBe(2);
    expect(occupied?.items).toHaveLength(1);
  });

  it("buildShelfCells 无格位货架按层聚合", () => {
    const inventory: InventoryItem[] = [
      {
        material_id: "mat_007",
        location_id: "loc_02",
        location_name: "B架",
        quantity: 4,
        row: 1,
      },
    ];
    const { cells } = buildShelfCells(shelf, inventory);
    expect(cells.some((c) => c.label === "第 1 层" && c.quantity === 4)).toBe(true);
  });

  it("formatLocationPath 拼接路径", () => {
    const locations: Location[] = [
      { id: "root", code: "R", name: "仓库", type: "区域" },
      { id: "loc_01", code: "A", name: "A柜", type: "货柜", parent_id: "root" },
    ];
    expect(formatLocationPath(locations, "loc_01")).toBe("仓库 / A柜");
  });
});
