import { describe, expect, it } from "vitest";
import type { Category } from "../api/types";
import { formatCategoryPath, getDescendantIds } from "./categoryTree";

const categories: Category[] = [
  { id: "cat_e", name: "电气类", parent_id: null, material_count: 10 },
  { id: "cat_motor", name: "电机模组", parent_id: "cat_e", material_count: 3 },
  { id: "cat_sensing", name: "感知设备", parent_id: "cat_e", material_count: 2 },
];

describe("categoryTree", () => {
  it("formatCategoryPath 输出分类路径", () => {
    expect(formatCategoryPath(categories, "cat_motor")).toBe("电气类 / 电机模组");
  });

  it("getDescendantIds 包含子类", () => {
    const ids = getDescendantIds(categories, "cat_e");
    expect(ids.has("cat_motor") && ids.has("cat_sensing")).toBe(true);
  });
});
