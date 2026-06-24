import { describe, expect, it } from "vitest";
import type { Location } from "../api/types";
import { formatLocationPath, getDescendantIds, getLocationChildren, getLocationPath } from "./locationTree";

const locations: Location[] = [
  { id: "root", code: "WH", name: "仓库", type: "区域" },
  { id: "loc_a", code: "A", name: "A区", type: "区域", parent_id: "root" },
  { id: "loc_01", code: "A-01", name: "A柜", type: "货柜", parent_id: "loc_a" },
  { id: "loc_02", code: "B-01", name: "B架", type: "货架", parent_id: "root" },
];

describe("locationTree", () => {
  it("getLocationChildren 返回同级节点", () => {
    const roots = getLocationChildren(locations, null);
    expect(roots.map((l) => l.id)).toEqual(["root"]);
    const underRoot = getLocationChildren(locations, "root");
    expect(underRoot.map((l) => l.id).sort()).toEqual(["loc_02", "loc_a"]);
  });

  it("getLocationPath 返回祖先链", () => {
    const path = getLocationPath(locations, "loc_01");
    expect(path.map((l) => l.name)).toEqual(["仓库", "A区", "A柜"]);
  });

  it("getDescendantIds 包含自身与子孙", () => {
    const ids = getDescendantIds(locations, "root");
    expect(ids.has("loc_01")).toBe(true);
    expect(ids.has("loc_02")).toBe(true);
  });

  it("formatLocationPath 输出可读路径", () => {
    expect(formatLocationPath(locations, "loc_01")).toBe("仓库 / A区 / A柜");
  });
});
