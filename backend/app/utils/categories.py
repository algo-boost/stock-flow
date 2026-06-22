from __future__ import annotations

from collections.abc import Iterable

from app.models import Category, Material
from app.data.category_taxonomy import CHILD_ORDER, ROOT_ORDER


def _sort_categories(items: list[Category], parent: Category | None) -> list[Category]:
    order = ROOT_ORDER if parent is None else CHILD_ORDER.get(parent.name, [])
    if not order:
        return sorted(items, key=lambda c: c.name)

    def rank(category: Category) -> tuple[int, str]:
        try:
            return order.index(category.name), category.name
        except ValueError:
            return len(order) + 1, category.name

    return sorted(items, key=rank)


def category_children(categories: dict[str, Category], parent_id: str | None) -> list[Category]:
    parent = categories.get(parent_id) if parent_id else None
    items = [c for c in categories.values() if c.parent_id == parent_id]
    return _sort_categories(items, parent)


def category_descendant_ids(categories: dict[str, Category], category_id: str) -> set[str]:
    ids = {category_id}
    for child in category_children(categories, category_id):
        ids |= category_descendant_ids(categories, child.id)
    return ids


def category_path_labels(categories: dict[str, Category], category_id: str) -> list[str]:
    labels: list[str] = []
    current = categories.get(category_id)
    while current:
        labels.insert(0, current.name)
        current = categories.get(current.parent_id) if current.parent_id else None
    return labels


def derive_major_sub_names(
    categories: dict[str, Category], parent_id: str | None, name: str
) -> tuple[str | None, str | None]:
    if not parent_id:
        return name, None
    parent = categories.get(parent_id)
    if not parent:
        return name, None
    if not parent.parent_id:
        return parent.name, name
    root_id: str | None = parent_id
    while root_id and categories[root_id].parent_id:
        root_id = categories[root_id].parent_id
    root_name = categories[root_id].name if root_id else parent.major_name
    return root_name, name


def category_subtree_stats(
    categories: dict[str, Category],
    materials: Iterable[Material],
    material_stock: dict[str, int] | None = None,
) -> tuple[dict[str, int], dict[str, int]]:
    """按分类子树汇总物料 SKU 数与库存件数（含自身及下级分类）。"""
    sku_counts = {category_id: 0 for category_id in categories}
    stock_counts = {category_id: 0 for category_id in categories}
    stock_by_material = material_stock or {}

    for material in materials:
        category_id = material.category_id
        if category_id not in categories:
            continue
        stock_qty = stock_by_material.get(material.id, 0)
        current = categories.get(category_id)
        while current:
            sku_counts[current.id] += 1
            stock_counts[current.id] += stock_qty
            current = categories.get(current.parent_id) if current.parent_id else None

    return sku_counts, stock_counts


def attach_category_stats(
    categories: list[Category],
    materials: Iterable[Material],
    material_stock: dict[str, int] | None = None,
) -> list[Category]:
    category_map = {category.id: category for category in categories}
    sku_counts, stock_counts = category_subtree_stats(category_map, materials, material_stock)
    enriched: list[Category] = []
    for category in categories:
        enriched.append(
            category.model_copy(
                update={
                    "material_count": sku_counts.get(category.id, 0),
                    "stock_quantity": stock_counts.get(category.id, 0),
                }
            )
        )
    return _sort_categories(enriched, None)
