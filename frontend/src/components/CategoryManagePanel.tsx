import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActionSheet, Toast } from "antd-mobile";
import { createCategory, deleteCategory, listCategories, updateCategory } from "../api";
import type { Category } from "../api/types";
import { getRootCategories } from "../utils/categoryTree";
import { CategoryTree } from "./CategoryTree";
import { FeishuIcon } from "./FeishuIcon";
import { MaterialCreateDialog } from "./MaterialCreatePanel";
import { EmptyState, SectionCard } from "./ui";

export function CategoryManagePanel() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [createMenuVisible, setCreateMenuVisible] = useState(false);
  const [materialDialogVisible, setMaterialDialogVisible] = useState(false);
  const [materialCategoryId, setMaterialCategoryId] = useState<string | null>(null);
  const openAddRootRef = useRef<(() => void) | null>(null);

  const loadCategories = useCallback(async () => {
    setLoading(true);
    try {
      setCategories(await listCategories());
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "加载分类失败" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  const rootCount = useMemo(() => getRootCategories(categories).length, [categories]);

  const openMaterialDialog = (categoryId?: string | null) => {
    setMaterialCategoryId(categoryId ?? selectedId);
    setMaterialDialogVisible(true);
  };

  if (loading) {
    return <EmptyState loading text="加载中…" />;
  }

  return (
    <>
      <SectionCard
        className="category-manage-section flush-body"
        title={
          <>
            分类与物料
            <span className="section-card-count">{rootCount}</span>
          </>
        }
        subtitle="维护分类目录 · 创建物料后需入库"
        extra={
          <button
            type="button"
            className="section-card-action"
            onClick={() => setCreateMenuVisible(true)}
          >
            <FeishuIcon name="plus" size={16} />
            新建
          </button>
        }
      >
        <CategoryTree
          categories={categories}
          selectedId={selectedId}
          onSelect={setSelectedId}
          canManage
          onCreate={async (payload) => {
            await createCategory(payload);
          }}
          onDelete={async (categoryId) => {
            await deleteCategory(categoryId);
          }}
          onUpdate={async (categoryId, payload) => {
            await updateCategory(categoryId, payload);
          }}
          onRefresh={loadCategories}
          onAddMaterial={(categoryId) => openMaterialDialog(categoryId)}
          onRegisterAddRoot={(openAddRoot) => {
            openAddRootRef.current = openAddRoot;
          }}
        />
      </SectionCard>

      <ActionSheet
        visible={createMenuVisible}
        actions={[
          { text: "新建分类", key: "category" },
          { text: "新建物料", key: "material" },
        ]}
        cancelText="取消"
        onClose={() => setCreateMenuVisible(false)}
        onAction={(action) => {
          setCreateMenuVisible(false);
          if (action.key === "category") {
            openAddRootRef.current?.();
            return;
          }
          openMaterialDialog(selectedId);
        }}
      />

      <MaterialCreateDialog
        visible={materialDialogVisible}
        categories={categories}
        initialCategoryId={materialCategoryId}
        onClose={() => setMaterialDialogVisible(false)}
        onCreated={loadCategories}
      />
    </>
  );
}
