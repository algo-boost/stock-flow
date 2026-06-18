import { useEffect, useMemo, useState } from "react";
import { Button, Dialog, Input, Toast } from "antd-mobile";
import type { Category } from "../api/types";
import {
  formatCategoryPath,
  getCategoryChildren,
  getCategoryPath,
  getRootCategories,
} from "../utils/categoryTree";

interface CategoryTreeProps {
  categories: Category[];
  selectedId: string | null;
  onSelect: (categoryId: string | null) => void;
  canManage?: boolean;
  onCreate?: (payload: { name: string; parent_id: string | null }) => Promise<void>;
  onDelete?: (categoryId: string) => Promise<void>;
  onRefresh?: () => Promise<void>;
}

function collectAncestorIds(categories: Category[], categoryId: string | null): Set<string> {
  const ids = new Set<string>();
  if (!categoryId) return ids;
  for (const node of getCategoryPath(categories, categoryId)) {
    ids.add(node.id);
  }
  return ids;
}

export function CategoryTree({
  categories,
  selectedId,
  onSelect,
  canManage = false,
  onCreate,
  onDelete,
  onRefresh,
}: CategoryTreeProps) {
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const roots = useMemo(() => getRootCategories(categories), [categories]);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const next = new Set<string>();
    if (selectedId) {
      for (const id of collectAncestorIds(categories, selectedId)) {
        next.add(id);
      }
    } else if (roots[0]) {
      next.add(roots[0].id);
    }
    setExpandedIds(next);
  }, [categories, selectedId, roots]);

  const toggleExpand = (categoryId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  };

  const renderNode = (category: Category, depth: number) => {
    const children = getCategoryChildren(categories, category.id);
    const hasChildren = children.length > 0;
    const expanded = expandedIds.has(category.id);
    const selected = selectedId === category.id;

    return (
      <div className="category-tree-branch" key={category.id}>
        <div
          className={`category-tree-row ${selected ? "category-tree-row-active" : ""}`}
          style={{ paddingLeft: `${12 + depth * 16}px` }}
        >
          {hasChildren ? (
            <button
              type="button"
              className="category-tree-toggle"
              aria-label={expanded ? "收起" : "展开"}
              onClick={() => toggleExpand(category.id)}
            >
              {expanded ? "▾" : "▸"}
            </button>
          ) : (
            <span className="category-tree-toggle-spacer" aria-hidden />
          )}
          <button type="button" className="category-tree-label" onClick={() => onSelect(category.id)}>
            <span>{category.name}</span>
            {(category.stock_quantity ?? 0) > 0 && (
              <span className="category-tree-count">{category.stock_quantity}</span>
            )}
          </button>
        </div>
        {hasChildren && expanded && (
          <div className="category-tree-children">
            {children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const handleCreate = async (parentId: string | null) => {
    const name = newName.trim();
    if (!name) {
      Toast.show({ content: "请输入分类名称" });
      return;
    }
    if (!onCreate) return;
    setBusy(true);
    try {
      await onCreate({ name, parent_id: parentId });
      setNewName("");
      Toast.show({ icon: "success", content: parentId ? "子分类已添加" : "顶层分类已添加" });
      await onRefresh?.();
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "添加分类失败" });
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedId || !onDelete) return;
    const path = formatCategoryPath(categories, selectedId);
    const confirmed = await Dialog.confirm({
      content: `确定删除「${path}」？\n\n将同时删除其下所有子分类；关联物料会自动改挂到上一级分类。`,
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      await onDelete(selectedId);
      onSelect(null);
      Toast.show({ icon: "success", content: "分类已删除" });
      await onRefresh?.();
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "删除分类失败" });
    } finally {
      setBusy(false);
    }
  };

  const addParentId = selectedId ?? null;

  if (categories.length === 0) {
    return null;
  }

  return (
    <div className="category-tree">
      <button
        type="button"
        className={`category-tree-all ${selectedId === null ? "category-tree-row-active" : ""}`}
        onClick={() => onSelect(null)}
      >
        全部分类
      </button>

      <div className="category-tree-list">{roots.map((root) => renderNode(root, 0))}</div>

      {selectedId && (
        <div className="category-tree-path">已选：{formatCategoryPath(categories, selectedId)}</div>
      )}

      {canManage && (
        <div className="category-tree-admin">
          <Input placeholder="输入新分类名称" value={newName} onChange={setNewName} clearable />
          <div className="category-tree-admin-actions">
            <Button size="small" color="primary" loading={busy} onClick={() => void handleCreate(null)}>
              添加顶层
            </Button>
            <Button
              size="small"
              color="primary"
              fill="outline"
              disabled={!addParentId}
              loading={busy}
              onClick={() => void handleCreate(addParentId)}
            >
              添加子类
            </Button>
            <Button
              size="small"
              color="danger"
              fill="outline"
              disabled={!selectedId}
              loading={busy}
              onClick={() => void handleDelete()}
            >
              删除选中
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
