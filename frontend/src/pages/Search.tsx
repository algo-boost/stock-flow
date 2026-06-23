import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, SearchBar, Toast } from "antd-mobile";
import { useLocation, useNavigate } from "react-router-dom";
import { createCategory, deleteCategory, listCategories, searchMaterials, updateCategory } from "../api";
import type { Category, MaterialSearchItem } from "../api/types";
import { CategoryTree } from "../components/CategoryTree";
import { useAuth } from "../components/AuthGate";
import { Layout } from "../components/Layout";
import { EmptyState, MaterialCard, PageHero, RolePermissions, SectionCard } from "../components/ui";
import { formatCategoryPath, canBrowseCategoryMaterials, isSubCategory } from "../utils/categoryTree";

interface SearchSuggestion {
  label: string;
  value: string;
  hint: string;
  kind: "category" | "material";
  categoryId?: string;
}

export default function SearchPage() {
  const pageSize = 20;
  const [keyword, setKeyword] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [items, setItems] = useState<MaterialSearchItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("recent_searches") || "[]"); } catch { return []; }
  });
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";

  const loadCategories = useCallback(async () => {
    const data = await listCategories();
    setCategories(data);
  }, []);

  const loadMaterials = useCallback(
    async (q: string, nextPage = 1, append = false, categoryId: string | null = null) => {
      setLoading(true);
      try {
        const data = await searchMaterials(q.trim(), {
          page: nextPage,
          size: pageSize,
          searchBy: "all",
          category: categoryId ?? undefined,
        });
        setItems((current) => (append ? [...current, ...data.items] : data.items));
        setPage(data.page);
        setTotal(data.total);
      } catch (e) {
        Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "搜索失败" });
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const shouldLoadMaterials = useCallback(
    (categoryId: string | null, q: string) =>
      Boolean(q.trim()) || canBrowseCategoryMaterials(categories, categoryId),
    [categories],
  );

  useEffect(() => {
    if (location.pathname !== "/") return;
    void loadCategories().catch((e) => {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "加载分类失败" });
    });
  }, [location.pathname, location.key, loadCategories]);

  useEffect(() => {
    if (location.pathname !== "/") return;
    if (shouldLoadMaterials(selectedCategoryId, keyword)) {
      void loadMaterials(keyword, 1, false, selectedCategoryId);
    } else {
      setItems([]);
      setTotal(0);
      setPage(1);
      setLoading(false);
    }
  }, [
    location.pathname,
    location.key,
    keyword,
    selectedCategoryId,
    loadMaterials,
    shouldLoadMaterials,
  ]);

  const categorySuggestionPool = useMemo(
    () =>
      categories.map((category) => ({
        label: formatCategoryPath(categories, category.id) || category.name,
        value: category.name,
        hint: "分类",
        kind: "category" as const,
        categoryId: category.id,
      })),
    [categories],
  );

  useEffect(() => {
    const text = keyword.trim().toLowerCase();
    if (!text) {
      setSuggestions([]);
      return;
    }

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const categoryMatches = categorySuggestionPool
            .filter(
              (item) =>
                item.label.toLowerCase().includes(text) || item.value.toLowerCase().includes(text),
            )
            .slice(0, 3);

          const data = await searchMaterials(keyword.trim(), { page: 1, size: 5, searchBy: "all" });
          const seen = new Set<string>();
          const materialMatches: SearchSuggestion[] = [];
          for (const item of data.items) {
            if (seen.has(item.id)) continue;
            seen.add(item.id);
            const meta = [item.code, item.spec].filter(Boolean).join(" · ");
            const category =
              [item.major_category, item.mid_category, item.sub_category]
                .filter(Boolean)
                .join(" / ") || item.category_name;
            materialMatches.push({
              label: item.name,
              value: item.name,
              hint: meta || category || "物料",
              kind: "material",
            });
          }

          setSuggestions([...categoryMatches, ...materialMatches].slice(0, 6));
        } catch {
          setSuggestions([]);
        }
      })();
    }, 220);

    return () => window.clearTimeout(timer);
  }, [categorySuggestionPool, keyword]);

  const saveSearch = (term: string) => {
    if (!term.trim()) return;
    setRecentSearches((prev) => {
      const next = [term, ...prev.filter((s) => s !== term)].slice(0, 5);
      localStorage.setItem("recent_searches", JSON.stringify(next));
      return next;
    });
  };

  const onSearch = (val: string) => {
    saveSearch(val);
    setKeyword(val);
    setSelectedCategoryId(null);
    setSuggestions([]);
    void loadMaterials(val, 1, false, null);
  };

  const chooseSuggestion = (suggestion: SearchSuggestion) => {
    setSuggestions([]);
    if (suggestion.kind === "category" && suggestion.categoryId) {
      if (
        isSubCategory(categories, suggestion.categoryId) &&
        !canBrowseCategoryMaterials(categories, suggestion.categoryId) &&
        !isAdmin
      ) {
        return;
      }
      setKeyword("");
      setSelectedCategoryId(suggestion.categoryId);
      return;
    }
    setKeyword(suggestion.value);
    setSelectedCategoryId(null);
    void loadMaterials(suggestion.value, 1, false, null);
  };

  const onCategorySelect = (categoryId: string | null) => {
    if (
      categoryId &&
      isSubCategory(categories, categoryId) &&
      !canBrowseCategoryMaterials(categories, categoryId) &&
      !isAdmin
    ) {
      return;
    }
    setSelectedCategoryId(categoryId);
    setKeyword("");
    setSuggestions([]);
  };

  const loadMore = () => {
    void loadMaterials(keyword, page + 1, true, selectedCategoryId);
  };

  const hasMore = items.length < total;
  const showMaterialsInTree =
    canBrowseCategoryMaterials(categories, selectedCategoryId) && !keyword.trim();
  const showMaterialsAtBottom = Boolean(keyword.trim());

  const materialList = (empty: { text: string; hint: string }) => (
    <>
      {!loading && items.length === 0 && <EmptyState icon="📭" text={empty.text} hint={empty.hint} />}
      {items.map((m) => {
        const isLowStock = m.total_quantity < (m.min_stock ?? 5);
        return (
          <MaterialCard
            key={m.id}
            name={m.name}
            code={m.code}
            category={
                [m.major_category, m.mid_category, m.sub_category]
                  .filter(Boolean)
                  .join(" / ") || m.category_name
              }
            quantity={m.total_quantity}
            warning={isLowStock ? "low" : undefined}
            stockSummary={m.locations_summary ?? undefined}
            onClick={() => navigate(`/materials/${m.id}`)}
            actions={[
              { text: "查看详情", key: "detail" },
              ...(user?.role === "ADMIN" || user?.role === "KEEPER"
                ? [
                    { text: "出库", key: "outbound" },
                    { text: "入库", key: "inbound" },
                    { text: "移动", key: "transfer" },
                  ]
                : [
                    { text: "申请出库", key: "req-outbound" },
                    { text: "申请入库", key: "req-inbound" },
                  ]),
              ...(isAdmin ? [
                    { text: "修改物料", key: "edit" },
                    { text: "进货", key: "purchase" },
                  ] : []),
            ]}
            onAction={(action) => {
              const id = m.id;
              switch (action.key) {
                case "detail":
                  navigate(`/materials/${id}`);
                  break;
                case "outbound":
                  navigate(`/stock?material_id=${id}`);
                  break;
                case "inbound":
                  navigate(`/stock?tab=inbound&material_id=${id}`);
                  break;
                case "transfer":
                  navigate(`/locations?tab=transfer&material_id=${id}`);
                  break;
                case "req-outbound":
                  navigate(`/stock?material_id=${id}`);
                  break;
                case "req-inbound":
                  navigate(`/stock?tab=inbound&material_id=${id}`);
                  break;
                case "edit":
                  navigate(`/materials/${id}`);
                  break;
                case "purchase":
                  navigate(`/purchase?material_id=${id}`);
                  break;
              }
            }}
          />
        );
      })}
      {hasMore && (
        <div className="load-more">
          <Button loading={loading} fill="outline" block onClick={loadMore}>
            加载更多
          </Button>
        </div>
      )}
    </>
  );

  return (
    <Layout title="物料管理系统">
      <PageHero
        title={`你好，${user?.name ?? "用户"}`}
        subtitle="搜索物料、查看库存；其他功能请用底部导航"
      />

      {user && (
        <SectionCard title="我的权限">
          <RolePermissions role={user.role} />
        </SectionCard>
      )}

      <SectionCard title="搜索物料" subtitle="输入名称、编码、型号、分类等关键词，自动组合搜索">
        <div className="search-card">
          <SearchBar
            placeholder="搜索名称、编码、型号、分类…"
            value={keyword}
            onChange={setKeyword}
            onSearch={onSearch}
            onClear={() => {
              setKeyword("");
              setSelectedCategoryId(null);
              setSuggestions([]);
              void loadMaterials("", 1, false, null);
            }}
          />
          {/* 最近搜索 */}
          {!keyword && recentSearches.length > 0 && suggestions.length === 0 && (
            <div className="search-suggestions">
              <div style={{ padding: "8px 12px 4px", fontSize: 12, color: "var(--sf-text-muted)", fontWeight: 600 }}>
                最近搜索
              </div>
              {recentSearches.map((term) => (
                <button
                  key={term}
                  type="button"
                  className="search-suggestion"
                  onClick={() => { setKeyword(term); onSearch(term); }}
                >
                  <span className="search-suggestion-label">🕐 {term}</span>
                </button>
              ))}
            </div>
          )}
          {suggestions.length > 0 && (
            <div className="search-suggestions">
              {suggestions.map((suggestion) => (
                <button
                  key={`${suggestion.kind}-${suggestion.hint}-${suggestion.value}`}
                  type="button"
                  className="search-suggestion"
                  onClick={() => chooseSuggestion(suggestion)}
                >
                  <span className="search-suggestion-label">{suggestion.label}</span>
                  <span className="search-suggestion-hint">{suggestion.hint}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </SectionCard>

      <SectionCard
        title="分类浏览"
        subtitle="展开大类后，仅有物料的子类可点击查看；数字为库存合计"
      >
        {categories.length === 0 ? (
          <EmptyState icon="🏷️" text="暂无分类数据" hint="管理员可添加顶层分类，或先在 Bitable 维护 categories 表" />
        ) : (
          <CategoryTree
            categories={categories}
            selectedId={selectedCategoryId}
            onSelect={onCategorySelect}
            renderMaterialsPanel={
              showMaterialsInTree ? (
                <>
                  <div className="category-tree-materials-head">
                    {loading && items.length === 0 ? "加载中…" : `共 ${total} 种物料`}
                  </div>
                  {materialList({ text: "该分类下暂无物料", hint: "可尝试选择上级分类或搜索关键词" })}
                </>
              ) : undefined
            }
            canManage={isAdmin}
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
            onAddMaterial={(categoryId) => {
              navigate(`/stock?tab=inbound&category_id=${categoryId}`);
            }}
          />
        )}
      </SectionCard>

      {showMaterialsAtBottom && (
        <SectionCard
          title={loading && items.length === 0 ? "加载中…" : `找到 ${total} 条`}
          subtitle="红色库存表示低于安全库存"
        >
          {materialList({ text: "没有匹配的物料", hint: "换个关键词或分类试试" })}
        </SectionCard>
      )}
    </Layout>
  );
}
