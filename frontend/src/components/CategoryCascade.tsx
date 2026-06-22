import { useEffect, useMemo, useState } from "react";
import { Button, Dialog, Input, Toast } from "antd-mobile";
import type { Category } from "../api/types";
import {
  buildCategorySections,
  formatCategoryPath,
  getActiveRootId,
  getCategoryPath,
  getRootCategories,
} from "../utils/categoryTree";

interface CategoryCascadeProps {
  categories: Category[];
  selectedId: string | null;
  onSelect: (categoryId: string | null) => void;
  canManage?: boolean;
  onCreate?: (payload: { name: string; parent_id: string | null }) => Promise<void>;
  onDelete?: (categoryId: string) => Promise<void>;
  onRefresh?: () => Promise<void>;
}

export function CategoryCascade({
  categories,
  selectedId,
  onSelect,
  canManage = false,
  onCreate,
  onDelete,
  onRefresh,
}: CategoryCascadeProps) {
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  const roots = useMemo(() => getRootCategories(categories), [categories]);
  const defaultRootId = roots[0]?.id ?? null;

  const [activeRootId, setActiveRootId] = useState<string | null>(defaultRootId);

  useEffect(() => {
    setActiveRootId(getActiveRootId(categories, selectedId, defaultRootId));
  }, [categories, selectedId, defaultRootId]);

  const sections = useMemo(
    () => buildCategorySections(categories, activeRootId),
    [categories, activeRootId],
  );

  const pathLabel = useMemo(() => formatCategoryPath(categories, selectedId), [categories, selectedId]);
  const childParentId = selectedId ?? activeRootId;

  const isSelectedInTree = (categoryId: string) => {
    if (selectedId === categoryId) return true;
    if (!selectedId) return false;
    const path = getCategoryPath(categories, selectedId);
    return path.some((item) => item.id === categoryId);
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
      if (!parentId) {
        onSelect(null);
      }
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

  if (categories.length === 0) {
    return null;
  }

  return (
    <div className="category-picker">
      <div className="category-picker-body">
        <aside className="category-picker-sidebar" aria-label="物料大类">
          <button
            type="button"
            className={`category-picker-side-item ${selectedId === null ? "category-picker-side-item-active" : ""}`}
            onClick={() => {
              setActiveRootId(defaultRootId);
              onSelect(null);
            }}
          >
            全部
          </button>
          {roots.map((root) => (
            <button
              key={root.id}
              type="button"
              className={`category-picker-side-item ${
                activeRootId === root.id ? "category-picker-side-item-active" : ""
              }`}
              onClick={() => {
                setActiveRootId(root.id);
                onSelect(root.id);
              }}
            >
              {root.name}
            </button>
          ))}
        </aside>

        <div className="category-picker-panel">
          {sections.length === 0 ? (
            <div className="category-picker-empty">该分类下暂无子目录，可在下方添加子分类</div>
          ) : (
            sections.map((section) => (
              <section className="category-picker-section" key={section.titleId}>
                {section.showTitle && (
                  <button
                    type="button"
                    className={`category-picker-section-title ${
                      isSelectedInTree(section.titleId) ? "category-picker-section-title-active" : ""
                    }`}
                    onClick={() => onSelect(section.titleId)}
                  >
                    {section.title}
                  </button>
                )}
                <div className="category-picker-grid">
                  {section.items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`category-picker-tag ${
                        selectedId === item.id ? "category-picker-tag-active" : ""
                      }`}
                      onClick={() => onSelect(item.id)}
                    >
                      {item.name}
                    </button>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </div>

      {pathLabel && <div className="category-picker-path">已选：{pathLabel}</div>}

      {canManage && (
        <div className="category-picker-admin">
          <Input placeholder="输入新分类名称，如：机械类、轴承" value={newName} onChange={setNewName} clearable />
          <div className="category-picker-admin-actions">
            <Button size="small" color="primary" loading={busy} onClick={() => void handleCreate(null)}>
              添加顶层
            </Button>
            <Button
              size="small"
              color="primary"
              fill="outline"
              disabled={!childParentId}
              loading={busy}
              onClick={() => void handleCreate(childParentId)}
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
          <div className="category-picker-admin-hint">
            「添加顶层」= 与电气类同级；「添加子类」= 在当前选中项（或左侧大类）下新增
          </div>
        </div>
      )}
    </div>
  );
}
