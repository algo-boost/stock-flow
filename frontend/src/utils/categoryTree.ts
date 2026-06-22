import type { Category } from "../api/types";
import { sortCategoriesForDisplay } from "./categoryOrder";

export function getCategoryChildren(categories: Category[], parentId: string | null): Category[] {
  const parent = parentId ? categories.find((item) => item.id === parentId) ?? null : null;
  const children = categories.filter((item) => (item.parent_id ?? null) === parentId);
  return sortCategoriesForDisplay(children, parent);
}

export function getCategoryPath(categories: Category[], categoryId: string | null): Category[] {
  if (!categoryId) return [];
  const map = new Map(categories.map((item) => [item.id, item]));
  const path: Category[] = [];
  let current = map.get(categoryId);
  while (current) {
    path.unshift(current);
    current = current.parent_id ? map.get(current.parent_id) : undefined;
  }
  return path;
}

export function getDescendantIds(categories: Category[], categoryId: string): Set<string> {
  const ids = new Set<string>([categoryId]);
  for (const child of getCategoryChildren(categories, categoryId)) {
    for (const id of getDescendantIds(categories, child.id)) {
      ids.add(id);
    }
  }
  return ids;
}

export interface CategorySection {
  title: string;
  titleId: string;
  items: Category[];
  showTitle: boolean;
}

export function getRootCategories(categories: Category[]): Category[] {
  return getCategoryChildren(categories, null);
}

export function getActiveRootId(
  categories: Category[],
  selectedId: string | null,
  fallbackRootId: string | null,
): string | null {
  if (selectedId) {
    const path = getCategoryPath(categories, selectedId);
    return path[0]?.id ?? fallbackRootId;
  }
  return fallbackRootId;
}

/** Boss 直聘式：左侧大类，右侧按分组标题 + 网格展示子类 */
export function buildCategorySections(categories: Category[], rootId: string | null): CategorySection[] {
  if (!rootId) return [];
  const level2 = getCategoryChildren(categories, rootId);
  return level2.map((group) => {
    const level3 = getCategoryChildren(categories, group.id);
    if (level3.length > 0) {
      return {
        title: group.name,
        titleId: group.id,
        items: level3,
        showTitle: true,
      };
    }
    return {
      title: group.name,
      titleId: group.id,
      items: [group],
      showTitle: false,
    };
  });
}

export function buildCascadeLevels(categories: Category[], selectedId: string | null): Category[][] {
  const levels: Category[][] = [];
  const path = getCategoryPath(categories, selectedId);
  let parentId: string | null = null;

  while (true) {
    const row = getCategoryChildren(categories, parentId);
    if (row.length === 0) break;
    levels.push(row);

    const active =
      path.find((item) => item.parent_id === parentId) ??
      (selectedId ? row.find((item) => item.id === selectedId) : undefined);

    if (!active) break;
    parentId = active.id;

    if (active.id === selectedId) {
      const children = getCategoryChildren(categories, selectedId);
      if (children.length > 0) {
        continue;
      }
      break;
    }
  }

  return levels;
}

export function formatCategoryPath(categories: Category[], categoryId: string | null): string {
  if (!categoryId) return "";
  return getCategoryPath(categories, categoryId)
    .map((item) => item.name)
    .join(" / ");
}

/** 是否为子类（有 parent_id 的非顶层分类，如「电机模组」；顶层大类如「电气类」为 false） */
export function isSubCategory(categories: Category[], categoryId: string | null): boolean {
  if (!categoryId) return false;
  const category = categories.find((item) => item.id === categoryId);
  return Boolean(category?.parent_id);
}

/** 子类下是否有物料 SKU（material_count 含下级汇总） */
export function canBrowseCategoryMaterials(categories: Category[], categoryId: string | null): boolean {
  if (!isSubCategory(categories, categoryId)) return false;
  const category = categories.find((item) => item.id === categoryId);
  return (category?.material_count ?? 0) > 0;
}

export function countCategoryMaterials(categories: Category[], categoryId: string, materialCategoryIds: string[]): number {
  const allowed = getDescendantIds(categories, categoryId);
  return materialCategoryIds.filter((id) => allowed.has(id)).length;
}
