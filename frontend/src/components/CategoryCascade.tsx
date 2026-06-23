import { useEffect, useMemo, useState } from "react";
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
}

export function CategoryCascade({
  categories,
  selectedId,
  onSelect,
}: CategoryCascadeProps) {
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

  const isSelectedInTree = (categoryId: string) => {
    if (selectedId === categoryId) return true;
    if (!selectedId) return false;
    const path = getCategoryPath(categories, selectedId);
    return path.some((item) => item.id === categoryId);
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
    </div>
  );
}
