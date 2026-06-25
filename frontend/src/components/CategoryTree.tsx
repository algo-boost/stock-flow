import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActionSheet, Dialog, Form, Input, Toast } from "antd-mobile";
import type { Category } from "../api/types";
import {
  getCategoryChildren,
  getCategoryPath,
  getDescendantIds,
  getRootCategories,
} from "../utils/categoryTree";
import { FeishuIcon } from "./FeishuIcon";
import { SwipeActionRow, type SwipeRowAction } from "./SwipeActionRow";

interface CategoryTreeProps {
  categories: Category[];
  selectedId: string | null;
  onSelect: (categoryId: string | null) => void;
  renderMaterialsPanel?: ReactNode;
  canManage?: boolean;
  onCreate?: (payload: { name: string; parent_id: string | null }) => Promise<void>;
  onDelete?: (categoryId: string) => Promise<void>;
  onUpdate?: (categoryId: string, payload: { name?: string; parent_id?: string | null }) => Promise<void>;
  onRefresh?: () => Promise<void>;
  onAddMaterial?: (categoryId: string) => void;
  onRegisterAddRoot?: (openAddRoot: () => void) => void;
}

type AddMode = { kind: "root" } | { kind: "child"; parentId: string };

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
  onAddMaterial,
  onRegisterAddRoot,
}: CategoryTreeProps) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [addVisible, setAddVisible] = useState(false);
  const [addMode, setAddMode] = useState<AddMode>({ kind: "root" });
  const [addName, setAddName] = useState("");
  const [actionTargetId, setActionTargetId] = useState<string | null>(null);
  const [openSwipeId, setOpenSwipeId] = useState<string | null>(null);
  const [menuVisible, setMenuVisible] = useState(false);
  const [menuCategoryId, setMenuCategoryId] = useState<string | null>(null);
  const roots = useMemo(() => getRootCategories(categories), [categories]);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const prevSelectedId = useRef<string | null>(null);

  const openAddRoot = useCallback(() => {
    setAddMode({ kind: "root" });
    setAddName("");
    setAddVisible(true);
  }, []);

  const openAddChild = useCallback((parentId: string) => {
    setAddMode({ kind: "child", parentId });
    setAddName("");
    setAddVisible(true);
  }, []);

  useEffect(() => {
    onRegisterAddRoot?.(openAddRoot);
  }, [onRegisterAddRoot, openAddRoot]);

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

  const submitAdd = () => {
    const name = addName.trim();
    if (!name || !onCreate) return;
    const parent_id = addMode.kind === "root" ? null : addMode.parentId;
    setBusy(true);
    void onCreate({ name, parent_id })
      .then(() => {
        setAddVisible(false);
        setAddName("");
        Toast.show({
          icon: "success",
          content: addMode.kind === "root" ? "一级分类已创建" : "子分类已创建",
        });
        if (addMode.kind === "child") {
          setExpandedIds((current) => new Set(current).add(addMode.parentId));
        }
        void onRefresh?.();
      })
      .catch((e: unknown) => {
        Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "创建失败" });
      })
      .finally(() => setBusy(false));
  };

  const confirmDelete = async (categoryId: string) => {
    if (!onDelete) return;
    const cat = categories.find((c) => c.id === categoryId);
    const descendants = getDescendantIds(categories, categoryId);
    const childCount = descendants.size;
    const childHint =
      childCount > 0
        ? `\n将同时删除其下 ${childCount} 个子分类；关联物料会自动改挂到上一级分类。`
        : "";
    const confirmed = await Dialog.confirm({
      content: `确定删除分类「${cat?.name ?? categoryId}」？${childHint}`,
    });
    if (!confirmed) return;
    setBusy(true);
    void onDelete(categoryId)
      .then(() => {
        if (selectedId === categoryId) onSelect(null);
        Toast.show({ icon: "success", content: "分类已删除" });
        void onRefresh?.();
      })
      .catch((e: unknown) => {
        Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "删除失败" });
      })
      .finally(() => setBusy(false));
  };

  const openRename = (categoryId: string) => {
    const cat = categories.find((c) => c.id === categoryId);
    setActionTargetId(categoryId);
    setEditName(cat?.name ?? "");
    setEditing(true);
  };

  const runCategoryAction = async (categoryId: string, action: string) => {
    switch (action) {
      case "add-child":
        openAddChild(categoryId);
        break;
      case "add-material":
        onAddMaterial?.(categoryId);
        break;
      case "rename":
        openRename(categoryId);
        break;
      case "delete":
        await confirmDelete(categoryId);
        break;
    }
  };

  const openRowMenu = (categoryId: string) => {
    setOpenSwipeId(null);
    onSelect(categoryId);
    setMenuCategoryId(categoryId);
    setMenuVisible(true);
  };

  const buildSwipeActions = (categoryId: string): SwipeRowAction[] => [
    {
      key: "add-child",
      label: "子分类",
      tone: "primary",
      onClick: () => void runCategoryAction(categoryId, "add-child"),
    },
    {
      key: "add-material",
      label: "物料",
      tone: "default",
      onClick: () => void runCategoryAction(categoryId, "add-material"),
    },
    {
      key: "rename",
      label: "重命名",
      tone: "default",
      onClick: () => void runCategoryAction(categoryId, "rename"),
    },
    {
      key: "delete",
      label: "删除",
      tone: "danger",
      disabled: busy,
      onClick: () => void runCategoryAction(categoryId, "delete"),
    },
  ];

  const renderNode = (category: Category, depth: number) => {
    const children = getCategoryChildren(categories, category.id);
    const hasChildren = children.length > 0;
    const expanded = expandedIds.has(category.id);
    const isSub = Boolean(category.parent_id);
    const hasMaterials = (category.material_count ?? 0) > 0;
    const browseDisabled = isSub && !hasMaterials && !canManage;
    const selected = selectedId === category.id;
    const stock = category.stock_quantity ?? 0;
    const materialCount = category.material_count ?? 0;

    const rowBody = (
      <div
        className={`category-tree-row ${selected ? "category-tree-row-active" : ""} ${
          browseDisabled ? "category-tree-row-muted" : ""
        }`}
        style={{ "--tree-depth": depth } as CSSProperties}
      >
        {hasChildren ? (
          <button
            type="button"
            className={`category-tree-toggle ${expanded ? "is-expanded" : ""}`}
            aria-label={expanded ? "收起" : "展开"}
            onClick={(event) => {
              event.stopPropagation();
              toggleExpand(category.id);
            }}
          >
            <FeishuIcon name="chevron-right" size={16} className="category-tree-toggle-icon" />
          </button>
        ) : (
          <span className="category-tree-toggle-spacer" aria-hidden />
        )}
        <button
          type="button"
          className="category-tree-label"
          disabled={browseDisabled}
          onClick={() => {
            if (openSwipeId === category.id) {
              setOpenSwipeId(null);
              return;
            }
            if (hasChildren) {
              toggleExpand(category.id);
            }
            if (browseDisabled) return;
            if (selectedId === category.id) {
              onSelect(null);
              return;
            }
            onSelect(category.id);
          }}
        >
          <span className="category-tree-name">{category.name}</span>
          <span className="category-tree-meta">
            {hasChildren && !canManage ? (
              <span className="category-tree-subhint">{children.length} 项</span>
            ) : null}
            {canManage && materialCount > 0 ? (
              <span className="category-tree-subhint">{materialCount} 物料</span>
            ) : null}
            {stock > 0 ? <span className="category-tree-count">{stock}</span> : null}
          </span>
        </button>
        {canManage ? (
          <button
            type="button"
            className="category-tree-menu-btn"
            aria-label="更多操作"
            onClick={(event) => {
              event.stopPropagation();
              openRowMenu(category.id);
            }}
          >
            <FeishuIcon name="more-horizontal" size={18} />
          </button>
        ) : null}
      </div>
    );

    return (
      <div className="category-tree-branch" key={category.id}>
        {canManage ? (
          <SwipeActionRow
            rowKey={category.id}
            openKey={openSwipeId}
            onOpenChange={setOpenSwipeId}
            actions={buildSwipeActions(category.id)}
            contentClassName={selected ? "category-tree-swipe-active" : ""}
          >
            {rowBody}
          </SwipeActionRow>
        ) : (
          rowBody
        )}
        {selected && renderMaterialsPanel ? (
          <div className="category-tree-materials">{renderMaterialsPanel}</div>
        ) : null}
        {hasChildren && expanded ? (
          <div className="category-tree-children">
            {children.map((child) => renderNode(child, depth + 1))}
          </div>
        ) : null}
      </div>
    );
  };

  const addParentName =
    addMode.kind === "child"
      ? categories.find((c) => c.id === addMode.parentId)?.name ?? ""
      : "";

  const menuCategory = menuCategoryId
    ? categories.find((c) => c.id === menuCategoryId)
    : null;

  return (
    <div className={`category-tree ${canManage ? "category-tree--manage" : ""}`}>
      {canManage && categories.length > 0 ? (
        <p className="category-tree-swipe-hint">左滑或点右侧 ··· 可管理 · 点击名称可选中</p>
      ) : null}

      <div className="category-tree-list">
        <div
          className={`category-tree-row category-tree-row-all ${
            selectedId === null ? "category-tree-row-active" : ""
          }`}
        >
          <span className="category-tree-all-icon" aria-hidden>
            <FeishuIcon name={selectedId === null ? "folder-open" : "folder"} size={18} />
          </span>
          <button
            type="button"
            className="category-tree-label"
            onClick={() => {
              setOpenSwipeId(null);
              setExpandedIds(new Set());
              onSelect(null);
            }}
          >
            <span className="category-tree-name">全部分类</span>
            <span className="category-tree-meta">
              <span className="category-tree-subhint">{roots.length} 个一级</span>
            </span>
          </button>
        </div>

        {categories.length === 0 ? (
          <div className="category-tree-empty">
            <FeishuIcon name="folder" size={28} />
            <p>还没有分类</p>
            {canManage ? <span>点击右上角「新建」添加一级分类</span> : null}
          </div>
        ) : (
          roots.map((root) => renderNode(root, 0))
        )}
      </div>

      <ActionSheet
        visible={menuVisible}
        extra={menuCategory ? `「${menuCategory.name}」` : undefined}
        actions={[
          { text: "添加子分类", key: "add-child" },
          { text: "新建物料", key: "add-material" },
          { text: "重命名", key: "rename" },
          { text: "删除", key: "delete", danger: true },
        ]}
        cancelText="取消"
        onClose={() => setMenuVisible(false)}
        onAction={async (action) => {
          setMenuVisible(false);
          if (!menuCategoryId) return;
          await runCategoryAction(menuCategoryId, action.key as string);
        }}
      />

      <Dialog
        visible={editing}
        title="重命名分类"
        content={
          <Form layout="vertical" className="form-card">
            <Form.Item label="分类名称">
              <Input value={editName} onChange={setEditName} placeholder="请输入名称" />
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
              const targetId = actionTargetId || selectedId;
              if (!targetId || !onUpdate) return;
              if (!editName.trim()) {
                Toast.show({ content: "请输入分类名称" });
                return;
              }
              setBusy(true);
              void onUpdate(targetId, { name: editName.trim() })
                .then(() => {
                  setEditing(false);
                  Toast.show({ icon: "success", content: "分类已更新" });
                  void onRefresh?.();
                })
                .catch((e: unknown) => {
                  Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "修改失败" });
                })
                .finally(() => setBusy(false));
            },
          },
        ]}
        onClose={() => setEditing(false)}
      />

      <Dialog
        visible={addVisible}
        title={addMode.kind === "root" ? "新建一级分类" : "新建子分类"}
        content={
          <Form layout="vertical" className="form-card">
            <Form.Item label={addMode.kind === "root" ? "层级" : "上级分类"}>
              <span className="category-add-context">
                {addMode.kind === "root" ? "一级分类（如：电气类、工具类）" : addParentName}
              </span>
            </Form.Item>
            <Form.Item label="分类名称">
              <Input
                value={addName}
                onChange={setAddName}
                placeholder={addMode.kind === "root" ? "如：工具类" : "如：连接器"}
              />
            </Form.Item>
          </Form>
        }
        actions={[
          { key: "cancel", text: "取消", onClick: () => setAddVisible(false) },
          {
            key: "save",
            text: busy ? "创建中…" : "创建",
            bold: true,
            onClick: () => {
              if (!addName.trim()) {
                Toast.show({ content: "请输入分类名称" });
                return;
              }
              submitAdd();
            },
          },
        ]}
        onClose={() => setAddVisible(false)}
      />
    </div>
  );
}
