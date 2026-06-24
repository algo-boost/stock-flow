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

export function getRootCategories(categories: Category[]): Category[] {
  return getCategoryChildren(categories, null);
}

export function formatCategoryPath(categories: Category[], categoryId: string | null): string {
  if (!categoryId) return "";
  return getCategoryPath(categories, categoryId)
    .map((item) => item.name)
    .join(" / ");
}
