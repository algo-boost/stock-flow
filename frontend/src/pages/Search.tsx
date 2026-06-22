import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, SearchBar, Toast } from "antd-mobile";
import { useLocation, useNavigate } from "react-router-dom";
import { createCategory, deleteCategory, listCategories, searchMaterials } from "../api";
import type { Category, MaterialSearchItem } from "../api/types";
import { CategoryTree } from "../components/CategoryTree";
import { useAuth } from "../components/AuthGate";
import { Layout } from "../components/Layout";
import { EmptyState, MaterialCard, PageHero, RolePermissions, SectionCard } from "../components/ui";
import { formatCategoryPath } from "../utils/categoryTree";

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
  const navigate = useNavigate();
  const location = useLocation();
  const { user, canInbound, canApprove } = useAuth();

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

  useEffect(() => {
    if (location.pathname !== "/") return;
    void loadCategories().catch((e) => {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "加载分类失败" });
    });
    void loadMaterials(keyword, 1, false, selectedCategoryId);
  }, [location.pathname, location.key, loadCategories, loadMaterials, keyword, selectedCategoryId]);

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
              item.major_category && item.sub_category
                ? `${item.major_category} / ${item.sub_category}`
                : item.category_name;
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

  const onSearch = (val: string) => {
    setKeyword(val);
    setSelectedCategoryId(null);
    setSuggestions([]);
    void loadMaterials(val, 1, false, null);
  };

  const chooseSuggestion = (suggestion: SearchSuggestion) => {
    setSuggestions([]);
    if (suggestion.kind === "category" && suggestion.categoryId) {
      setKeyword("");
      setSelectedCategoryId(suggestion.categoryId);
      void loadMaterials("", 1, false, suggestion.categoryId);
      return;
    }
    setKeyword(suggestion.value);
    setSelectedCategoryId(null);
    void loadMaterials(suggestion.value, 1, false, null);
  };

  const onCategorySelect = (categoryId: string | null) => {
    setSelectedCategoryId(categoryId);
    setKeyword("");
    setSuggestions([]);
    void loadMaterials("", 1, false, categoryId);
  };

  const loadMore = () => {
    void loadMaterials(keyword, page + 1, true, selectedCategoryId);
  };

  const hasMore = items.length < total;

  return (
    <Layout title="物料管理系统">
      <PageHero
        title={`你好，${user?.name ?? "用户"}`}
        subtitle="搜索物料、查看库存、快速出入库"
      />

      {user && (
        <SectionCard title="我的权限">
          <RolePermissions role={user.role} />
        </SectionCard>
      )}

      <div className="quick-actions">
        <button type="button" className="quick-action outbound" onClick={() => navigate("/stock")}>
          <span className="quick-action-icon">↕</span>
          <span className="quick-action-title">出入库</span>
          <span className="quick-action-desc">
            {canInbound ? "出库领用 / 入库上架" : "提交出入库申请"}
          </span>
        </button>
        {canInbound ? (
          <>
            <button type="button" className="quick-action" onClick={() => navigate("/locations")}>
              <span className="quick-action-icon">📍</span>
              <span className="quick-action-title">库位管理</span>
              <span className="quick-action-desc">维护库位 / 库内移动</span>
            </button>
            {canApprove && (
              <button type="button" className="quick-action" onClick={() => navigate("/admin-center")}>
                <span className="quick-action-icon">⚙</span>
                <span className="quick-action-title">运营中心</span>
                <span className="quick-action-desc">审批 / 缺货预警 / 配置审计</span>
              </button>
            )}
            {canApprove && (
              <button type="button" className="quick-action" onClick={() => navigate("/purchase")}>
                <span className="quick-action-icon">🛒</span>
                <span className="quick-action-title">进货补货</span>
                <span className="quick-action-desc">供货商 / 入库 / 预警</span>
              </button>
            )}
          </>
        ) : (
          <>
            <button type="button" className="quick-action" onClick={() => navigate("/history")}>
              <span className="quick-action-icon">📒</span>
              <span className="quick-action-title">我的历史</span>
              <span className="quick-action-desc">申请与流水记录</span>
            </button>
            <button type="button" className="quick-action" onClick={() => onSearch("")}>
              <span className="quick-action-icon">📋</span>
              <span className="quick-action-title">浏览全部</span>
              <span className="quick-action-desc">查看可用物料</span>
            </button>
          </>
        )}
      </div>

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
        subtitle="展开大类后选中类筛选；数字为该类及下级物料库存合计"
      >
        {categories.length === 0 ? (
          <EmptyState icon="🏷️" text="暂无分类数据" hint="管理员可添加顶层分类，或先在 Bitable 维护 categories 表" />
        ) : (
          <CategoryTree
            categories={categories}
            selectedId={selectedCategoryId}
            onSelect={onCategorySelect}
            canManage={user?.role === "ADMIN"}
            onCreate={async (payload) => {
              await createCategory(payload);
            }}
            onDelete={async (categoryId) => {
              await deleteCategory(categoryId);
            }}
            onRefresh={loadCategories}
          />
        )}
      </SectionCard>

      <SectionCard
        title={loading && items.length === 0 ? "加载中…" : keyword || selectedCategoryId ? `找到 ${total} 条` : `全部物料 ${total} 条`}
        subtitle="红色库存表示低于安全库存"
      >
        {!loading && items.length === 0 && (
          <EmptyState icon="📭" text="没有匹配的物料" hint="换个关键词试试" />
        )}
        {items.map((m) => {
          const isLowStock = m.total_quantity < (m.min_stock ?? 5);
          return (
            <MaterialCard
              key={m.id}
              name={m.name}
              code={m.code}
              category={
                m.major_category && m.sub_category
                  ? `${m.major_category} / ${m.sub_category}`
                  : m.category_name
              }
              spec={m.spec ?? undefined}
              unit={`总库存 ${m.total_quantity} ${m.unit}`}
              warning={isLowStock ? `缺货预警：低于安全库存 ${m.min_stock ?? 5}` : undefined}
              stockSummary={m.locations_summary ?? "暂无库位库存"}
              onClick={() => navigate(`/materials/${m.id}`)}
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
      </SectionCard>
    </Layout>
  );
}
