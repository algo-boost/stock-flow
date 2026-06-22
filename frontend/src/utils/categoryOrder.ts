import type { Category } from "../api/types";

/** 与 backend/app/data/category_taxonomy.py 一致 */
export const CATEGORY_ROOT_ORDER = ["电气类", "机械类", "耗材类", "其他类"];

export const CATEGORY_CHILD_ORDER: Record<string, string[]> = {
  电气类: ["电机模组", "感知设备", "算力设备", "电气设备", "线缆网线", "电池电源"],
  机械类: ["通用设备", "末端执行", "金属件"],
  耗材类: ["螺丝螺栓", "工具"],
  其他类: ["其他物品"],
};

function compareByNameOrder(order: string[], a: Category, b: Category): number {
  const ia = order.indexOf(a.name);
  const ib = order.indexOf(b.name);
  if (ia === -1 && ib === -1) return a.name.localeCompare(b.name, "zh-CN");
  if (ia === -1) return 1;
  if (ib === -1) return -1;
  return ia - ib;
}

export function sortCategoriesForDisplay(categories: Category[], parent: Category | null): Category[] {
  const order =
    parent === null
      ? CATEGORY_ROOT_ORDER
      : CATEGORY_CHILD_ORDER[parent.name] ?? CATEGORY_CHILD_ORDER[parent.major_name ?? ""] ?? [];
  return [...categories].sort((a, b) => compareByNameOrder(order, a, b));
}
