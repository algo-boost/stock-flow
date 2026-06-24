import { useCallback, useEffect, useState } from "react";
import { Toast } from "antd-mobile";
import { useNavigate } from "react-router-dom";
import { createCategory, deleteCategory, listCategories, updateCategory } from "../api";
import type { Category } from "../api/types";
import { CategoryTree } from "./CategoryTree";
import { EmptyState, SectionCard } from "./ui";

export function CategoryManagePanel() {
  const navigate = useNavigate();
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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

  if (loading) {
    return <EmptyState loading text="加载中…" />;
  }

  return (
    <SectionCard title="分类目录" className="flush-body">
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
        onAddMaterial={(categoryId) => navigate(`/stock?tab=inbound&category_id=${categoryId}`)}
      />
    </SectionCard>
  );
}
