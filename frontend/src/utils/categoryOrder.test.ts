import { describe, expect, it } from "vitest";
import { CATEGORY_CHILD_ORDER, CATEGORY_ROOT_ORDER, sortCategoriesForDisplay } from "./categoryOrder";
import type { Category } from "../api/types";

describe("categoryOrder", () => {
  it("预置分类顺序常量非空", () => {
    expect(CATEGORY_ROOT_ORDER.length).toBeGreaterThan(0);
    expect(CATEGORY_CHILD_ORDER["电气类"]?.length).toBeGreaterThan(0);
  });

  it("sortCategoriesForDisplay 按业务顺序排序", () => {
    const categories: Category[] = [
      { id: "c3", name: "耗材类", parent_id: null },
      { id: "c1", name: "电气类", parent_id: null },
      { id: "c2", name: "机械类", parent_id: null },
    ];
    const sorted = sortCategoriesForDisplay(categories, null);
    expect(sorted.map((c) => c.name)).toEqual(["电气类", "机械类", "耗材类"]);
  });
});
