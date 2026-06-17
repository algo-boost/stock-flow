import { useEffect, useMemo, useState } from "react";
import { Button, SearchBar, Selector, Toast } from "antd-mobile";
import { useNavigate } from "react-router-dom";
import { listCategories, searchMaterials } from "../api";
import type { Category, MaterialSearchItem } from "../api/types";
import { useAuth } from "../components/AuthGate";
import { Layout } from "../components/Layout";
import { EmptyState, MaterialCard, PageHero, RolePermissions, SectionCard } from "../components/ui";

type SearchMode = "category" | "name" | "code";

interface SearchSuggestion {
  label: string;
  value: string;
  hint: string;
}

interface CategoryGroup {
  major: string;
  subs: string[];
}

const SEARCH_MODE_OPTIONS: Array<{ label: string; value: SearchMode }> = [
  { label: "按分类", value: "category" },
  { label: "按名称", value: "name" },
  { label: "按编码", value: "code" },
];

export default function SearchPage() {
  const pageSize = 20;
  const [keyword, setKeyword] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("name");
  const [categories, setCategories] = useState<Category[]>([]);
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [selectedCategoryLabel, setSelectedCategoryLabel] = useState("");
  const [items, setItems] = useState<MaterialSearchItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { user, canInbound, canApprove } = useAuth();

  const loadMaterials = async (
    q: string,
    nextPage = 1,
    append = false,
    mode: SearchMode | "all" = searchMode,
  ) => {
    setLoading(true);
    try {
      const data = await searchMaterials(q.trim(), {
        page: nextPage,
        size: pageSize,
        searchBy: q.trim() ? mode : "all",
      });
      setItems((current) => (append ? [...current, ...data.items] : data.items));
      setPage(data.page);
      setTotal(data.total);
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "搜索失败" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadMaterials("", 1);
  }, []);

  useEffect(() => {
    void listCategories()
      .then(setCategories)
      .catch((e) => {
        Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "加载分类失败" });
      });
  }, []);

  const categorySuggestionPool = useMemo(() => {
    const seen = new Set<string>();
    const result: SearchSuggestion[] = [];
    for (const category of categories) {
      const major = category.major_name || category.name;
      const sub = category.sub_name || category.name;
      const full = major && sub && major !== sub ? `${major} / ${sub}` : sub;
      for (const item of [
        { label: full, value: sub, hint: major ? `子类 · ${major}` : "子类" },
        { label: major, value: major, hint: "大类" },
      ]) {
        if (!item.label || seen.has(item.label)) continue;
        seen.add(item.label);
        result.push(item);
      }
    }
    return result;
  }, [categories]);

  const categoryGroups = useMemo<CategoryGroup[]>(() => {
    const groups = new Map<string, Set<string>>();
    for (const category of categories) {
      const major = category.major_name || category.name;
      const sub = category.sub_name || category.name;
      if (!major) continue;
      if (!groups.has(major)) {
        groups.set(major, new Set());
      }
      if (sub && sub !== major) {
        groups.get(major)?.add(sub);
      }
    }
    return Array.from(groups.entries()).map(([major, subs]) => ({
      major,
      subs: Array.from(subs),
    }));
  }, [categories]);

  const activeCategoryGroup = useMemo(
    () =>
      categoryGroups.find(
        (group) => selectedCategoryLabel === group.major || group.subs.includes(selectedCategoryLabel),
      ) ?? categoryGroups[0],
    [categoryGroups, selectedCategoryLabel],
  );

  useEffect(() => {
    const text = keyword.trim().toLowerCase();
    if (!text) {
      setSuggestions([]);
      return;
    }

    if (searchMode === "category") {
      setSuggestions(
        categorySuggestionPool
          .filter((item) => item.label.toLowerCase().includes(text) || item.value.toLowerCase().includes(text))
          .slice(0, 5),
      );
      return;
    }

    const timer = window.setTimeout(() => {
      void searchMaterials(keyword.trim(), { page: 1, size: 5, searchBy: searchMode })
        .then((data) => {
          const seen = new Set<string>();
          const next: SearchSuggestion[] = [];
          for (const item of data.items) {
            const value = searchMode === "code" ? item.code : item.name;
            if (!value || seen.has(value)) continue;
            seen.add(value);
            next.push({
              label: value,
              value,
              hint:
                searchMode === "code"
                  ? item.name
                  : item.major_category && item.sub_category
                    ? `${item.major_category} / ${item.sub_category}`
                    : item.category_name ?? item.code,
            });
          }
          setSuggestions(next.slice(0, 5));
        })
        .catch(() => setSuggestions([]));
    }, 220);

    return () => window.clearTimeout(timer);
  }, [categorySuggestionPool, keyword, searchMode]);

  const onSearch = (val: string) => {
    setKeyword(val);
    setSelectedCategoryLabel(searchMode === "category" ? val.trim() : "");
    setSuggestions([]);
    void loadMaterials(val, 1, false, searchMode);
  };

  const chooseSuggestion = (suggestion: SearchSuggestion) => {
    setKeyword(suggestion.value);
    setSelectedCategoryLabel(searchMode === "category" ? suggestion.value : "");
    setSuggestions([]);
    void loadMaterials(suggestion.value, 1, false, searchMode);
  };

  const changeSearchMode = (mode: SearchMode) => {
    setSearchMode(mode);
    if (mode !== "category") {
      setSelectedCategoryLabel("");
    }
    setSuggestions([]);
    if (keyword.trim()) {
      void loadMaterials(keyword, 1, false, mode);
    }
  };

  const chooseCategory = (value: string) => {
    setSearchMode("category");
    setKeyword(value);
    setSelectedCategoryLabel(value);
    setSuggestions([]);
    void loadMaterials(value, 1, false, "category");
  };

  const clearCategoryFilter = () => {
    setKeyword("");
    setSelectedCategoryLabel("");
    setSuggestions([]);
    void loadMaterials("", 1, false, "all");
  };

  const loadMore = () => {
    void loadMaterials(keyword, page + 1, true);
  };

  const hasMore = items.length < total;

  return (
    <Layout title="物料管理">
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
        <button type="button" className="quick-action outbound" onClick={() => navigate("/outbound")}>
          <span className="quick-action-icon">📤</span>
          <span className="quick-action-title">{canInbound ? "出库领用" : "出库申请"}</span>
          <span className="quick-action-desc">{canInbound ? "记录项目领料" : "审批通过后扣减库存"}</span>
        </button>
        {canInbound ? (
          <>
            <button type="button" className="quick-action" onClick={() => navigate("/inbound")}>
              <span className="quick-action-icon">📥</span>
              <span className="quick-action-title">入库上架</span>
              <span className="quick-action-desc">采购 / 归还入库</span>
            </button>
            <button type="button" className="quick-action" onClick={() => navigate("/transfer")}>
              <span className="quick-action-icon">↔</span>
              <span className="quick-action-title">库内移动</span>
              <span className="quick-action-desc">暂存上架 / 整理库位</span>
            </button>
            <button type="button" className="quick-action" onClick={() => navigate("/locations")}>
              <span className="quick-action-icon">📍</span>
              <span className="quick-action-title">库位管理</span>
              <span className="quick-action-desc">新增 / 改名 / 删除</span>
            </button>
            {canApprove && (
              <button type="button" className="quick-action" onClick={() => navigate("/approvals")}>
                <span className="quick-action-icon">✅</span>
                <span className="quick-action-title">审批申请</span>
                <span className="quick-action-desc">通过后执行库存变更</span>
              </button>
            )}
            {canApprove && (
              <button type="button" className="quick-action" onClick={() => navigate("/purchase")}>
                <span className="quick-action-icon">🛒</span>
                <span className="quick-action-title">进货补货</span>
                <span className="quick-action-desc">供货商 / 入库 / 预警</span>
              </button>
            )}
            {canApprove && (
              <button type="button" className="quick-action" onClick={() => navigate("/admin-center")}>
                <span className="quick-action-icon">⚙</span>
                <span className="quick-action-title">运营中心</span>
                <span className="quick-action-desc">组织 / 配置 / 审计 / 统计</span>
              </button>
            )}
          </>
        ) : (
          <>
            <button type="button" className="quick-action" onClick={() => navigate("/inbound")}>
              <span className="quick-action-icon">📥</span>
              <span className="quick-action-title">入库申请</span>
              <span className="quick-action-desc">归还 / 入库待审批</span>
            </button>
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

      <SectionCard title="搜索物料" subtitle="可按分类、名称或编码搜索">
        <div className="search-card">
          <Selector
            className="search-mode-selector"
            options={SEARCH_MODE_OPTIONS}
            value={[searchMode]}
            onChange={(arr) => changeSearchMode((arr[0] as SearchMode | undefined) ?? "name")}
          />
          <SearchBar
            placeholder="输入关键词搜索…"
            value={keyword}
            onChange={setKeyword}
            onSearch={onSearch}
            onClear={() => {
              setKeyword("");
              setSelectedCategoryLabel("");
              setSuggestions([]);
              void loadMaterials("", 1);
            }}
          />
          {suggestions.length > 0 && (
            <div className="search-suggestions">
              {suggestions.map((suggestion) => (
                <button
                  key={`${suggestion.hint}-${suggestion.value}`}
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
        title="分类筛选"
        subtitle={selectedCategoryLabel ? `当前：${selectedCategoryLabel}` : "先选大类，再点子类；默认展示第一组"}
      >
        {categoryGroups.length === 0 ? (
          <EmptyState icon="🏷️" text="暂无分类数据" hint="请先在 Bitable categories 表维护大类和子类" />
        ) : (
          <div className="category-filter-compact">
            <div className="category-filter-toolbar">
              <div className="category-filter-major-scroll" aria-label="大类筛选">
                {categoryGroups.map((group) => {
                  const isActive =
                    selectedCategoryLabel === group.major || group.subs.includes(selectedCategoryLabel);
                  return (
                    <button
                      type="button"
                      className={`category-filter-major ${isActive ? "category-filter-active" : ""}`}
                      key={group.major}
                      onClick={() => chooseCategory(group.major)}
                    >
                      <span>{group.major}</span>
                      <span className="category-filter-count">{Math.max(group.subs.length, 1)}</span>
                    </button>
                  );
                })}
              </div>
              {selectedCategoryLabel && (
                <Button size="mini" fill="none" onClick={clearCategoryFilter}>
                  清除
                </Button>
              )}
            </div>

            {activeCategoryGroup && (
              <div className="category-filter-subs" aria-label={`${activeCategoryGroup.major} 子类筛选`}>
                <button
                  type="button"
                  className={`category-filter-sub ${
                    selectedCategoryLabel === activeCategoryGroup.major ? "category-filter-active" : ""
                  }`}
                  onClick={() => chooseCategory(activeCategoryGroup.major)}
                >
                  全部
                </button>
                {activeCategoryGroup.subs.length === 0 ? (
                  <span className="category-filter-empty">该大类暂无子类</span>
                ) : (
                  activeCategoryGroup.subs.map((sub) => (
                    <button
                      key={`${activeCategoryGroup.major}-${sub}`}
                      type="button"
                      className={`category-filter-sub ${
                        selectedCategoryLabel === sub ? "category-filter-active" : ""
                      }`}
                      onClick={() => chooseCategory(sub)}
                    >
                      {sub}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title={loading && items.length === 0 ? "加载中…" : keyword ? `找到 ${total} 条` : `全部物料 ${total} 条`}
        subtitle="默认显示全部物料，搜索后按关键词筛选"
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
              unit={`库存 ${m.total_quantity} ${m.unit}`}
              warning={isLowStock ? `缺货预警：低于安全库存 ${m.min_stock ?? 5}` : undefined}
              stockSummary={m.locations_summary ?? "暂无库存"}
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
