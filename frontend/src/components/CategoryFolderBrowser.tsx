import { useMemo } from "react";
import type { Category } from "../api/types";
import { getCategoryChildren, getCategoryPath } from "../utils/categoryTree";

interface CategoryFolderBrowserProps {
  categories: Category[];
  /** 当前所在文件夹，null = 根目录 */
  folderId: string | null;
  onOpenFolder: (categoryId: string) => void;
  onNavigate: (categoryId: string | null) => void;
}

export function CategoryFolderBrowser({
  categories,
  folderId,
  onOpenFolder,
  onNavigate,
}: CategoryFolderBrowserProps) {
  const path = useMemo(() => getCategoryPath(categories, folderId), [categories, folderId]);
  const folders = useMemo(() => getCategoryChildren(categories, folderId), [categories, folderId]);

  return (
    <div className="folder-browser">
      <nav className="folder-breadcrumb" aria-label="分类路径">
        <button type="button" className="folder-crumb" onClick={() => onNavigate(null)}>
          全部
        </button>
        {path.map((node, i) => (
          <span key={node.id} className="folder-crumb-wrap">
            <span className="folder-crumb-sep">/</span>
            <button
              type="button"
              className={`folder-crumb ${i === path.length - 1 ? "folder-crumb-active" : ""}`}
              onClick={() => onNavigate(node.id)}
            >
              {node.name}
            </button>
          </span>
        ))}
      </nav>

      {folders.length === 0 ? (
        <p className="folder-empty-hint">已到最底层，下方为该类物料</p>
      ) : (
        <div className="folder-grid">
          {folders.map((cat) => {
            const count = cat.material_count ?? 0;
            const stock = cat.stock_quantity ?? 0;
            const hasChildren = getCategoryChildren(categories, cat.id).length > 0;
            return (
              <button key={cat.id} type="button" className="folder-tile" onClick={() => onOpenFolder(cat.id)}>
                <span className="material-symbols-outlined folder-tile-icon" aria-hidden>
                  {hasChildren ? "folder" : "folder_open"}
                </span>
                <span className="folder-tile-name">{cat.name}</span>
                <span className="folder-tile-meta">
                  {count > 0 ? `${count} 种` : "空"}
                  {stock > 0 ? ` · ${stock} 件` : ""}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
