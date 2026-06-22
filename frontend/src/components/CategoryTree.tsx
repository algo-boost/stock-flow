import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Dialog, Form, Input, Toast } from "antd-mobile";
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
  /** 选中分类时，在对应节点下方展示物料列表 */
  renderMaterialsPanel?: ReactNode;
  canManage?: boolean;
  onCreate?: (payload: { name: string; parent_id: string | null }) => Promise<void>;
  onDelete?: (categoryId: string) => Promise<void>;
  onUpdate?: (categoryId: string, payload: { name?: string; parent_id?: string | null }) => Promise<void>;
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
  renderMaterialsPanel,
  canManage = false,
  onCreate,
  onDelete,
  onUpdate,
  onRefresh,
}: CategoryTreeProps) {
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const roots = useMemo(() => getRootCategories(categories), [categories]);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const prevSelectedId = useRef<string | null>(null);

  // 仅在选中变化时自动展开路径；手动折叠后不再被覆盖
  useEffect(() => {
    if (selectedId === null) {
      prevSelectedId.current = null;
      return;
    }

    if (prevSelectedId.current !== selectedId) {
      setExpandedIds((current) => {
        const next = new Set(current);
        for (const id of collectAncestorIds(categories, selectedId)) {
          next.add(id);
        }
        return next;
      });
      prevSelectedId.current = selectedId;
    }
  }, [categories, selectedId]);

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
    const isSub = Boolean(category.parent_id);
    const hasMaterials = (category.material_count ?? 0) > 0;
    const browseDisabled = isSub && !hasMaterials && !canManage;
    const selected = selectedId === category.id;

    return (
      <div className="category-tree-branch" key={category.id}>
        <div
          className={`category-tree-row ${selected ? "category-tree-row-active" : ""} ${
            browseDisabled ? "category-tree-row-muted" : ""
          }`}
          style={{ paddingLeft: `${12 + depth * 16}px` }}
        >
          {hasChildren ? (
            <button
              type="button"
              className="category-tree-toggle"
              aria-label={expanded ? "收起" : "展开"}
              onClick={(event) => {
                event.stopPropagation();
                toggleExpand(category.id);
              }}
            >
              {expanded ? "▾" : "▸"}
            </button>
          ) : (
            <span className="category-tree-toggle-spacer" aria-hidden />
          )}
          <button
            type="button"
            className="category-tree-label"
            disabled={browseDisabled}
            onClick={() => {
              if (hasChildren) {
                toggleExpand(category.id);
                if (canManage) onSelect(category.id);
                return;
              }
              if (browseDisabled) return;
              if (selectedId === category.id) {
                onSelect(null);
                return;
              }
              onSelect(category.id);
            }}
          >
            <span>{category.name}</span>
            {(category.stock_quantity ?? 0) > 0 && (
              <span className="category-tree-count">{category.stock_quantity}</span>
            )}
          </button>
        </div>
        {selected && renderMaterialsPanel ? (
          <div className="category-tree-materials" style={{ paddingLeft: `${12 + depth * 16 + 28}px` }}>
            {renderMaterialsPanel}
          </div>
        ) : null}
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
        onClick={() => {
          setExpandedIds(new Set());
          onSelect(null);
        }}
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
            <Button
              size="small"
              fill="outline"
              disabled={!selectedId}
              loading={busy}
              onClick={() => {
                const cat = categories.find((c) => c.id === selectedId);
                setEditName(cat?.name ?? "");
                setEditing(true);
              }}
            >
              编辑选中
            </Button>
          </div>
        </div>
      )}

      <Dialog
        visible={editing}
        title="修改分类"
        content={
          <Form layout="vertical" className="form-card">
            <Form.Item label="分类名称">
              <Input value={editName} onChange={setEditName} />
            </Form.Item>
          </Form>
        }
        actions={[
          { key: "cancel", text: "取消", onClick: () => setEditing(false) },
          {
            key: "save",
            text: busy ? "保存中…" : "保存",
            bold: true,
            onClick: () => {
              if (!selectedId || !onUpdate) return;
              if (!editName.trim()) {
                Toast.show({ content: "请输入分类名称" });
                return;
              }
              setBusy(true);
              void onUpdate(selectedId, { name: editName.trim() }).then(() => {
                setEditing(false);
                Toast.show({ icon: "success", content: "分类已更新" });
                void onRefresh?.();
              }).catch((e: unknown) => {
                Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "修改失败" });
              }).finally(() => setBusy(false));
            },
          },
        ]}
        onClose={() => setEditing(false)}
      />
    </div>
  );
}
