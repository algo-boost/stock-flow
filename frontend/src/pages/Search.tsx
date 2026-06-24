import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Selector, Toast } from "antd-mobile";
import { useLocation, useNavigate } from "react-router-dom";
import {
  listCategories,
  listInventory,
  listLocations,
  listLowStock,
  listTransactions,
  searchMaterials,
} from "../api";
import type { Category, InventoryItem, Location, MaterialSearchItem } from "../api/types";
import { CategoryFolderBrowser } from "../components/CategoryFolderBrowser";
import { StorageUnitPicker } from "../components/StorageUnitPicker";
import { useAuth } from "../components/AuthGate";
import { Layout } from "../components/Layout";
import { EmptyState, MaterialCard, SectionCard } from "../components/ui";
import type { DateRangePreset } from "../utils/historyDisplay";
import { resolveDateRange } from "../utils/historyDisplay";
import { getDescendantIds } from "../utils/categoryTree";
import { getLocationChildren } from "../utils/locationTree";
import { isGridCapableLocation } from "../utils/shelfGrid";

type BrowseBy = "category" | "location";
type StockFilter = "all" | "instock" | "low";

const STOCK_OPTIONS: Array<{ label: string; value: StockFilter }> = [
  { label: "全部", value: "all" },
  { label: "有库存", value: "instock" },
  { label: "缺货", value: "low" },
];

const INBOUND_TIME_OPTIONS: Array<{ label: string; value: DateRangePreset }> = [
  { label: "不限", value: "all" },
  { label: "近7天", value: "7d" },
  { label: "近30天", value: "30d" },
  { label: "自定义", value: "custom" },
];

function loadBrowseBy(): BrowseBy {
  try {
    const saved = localStorage.getItem("home_browse_by") ?? localStorage.getItem("home_view_mode");
    if (saved === "location") return "location";
    return "category";
  } catch {
    return "category";
  }
}

export default function SearchPage() {
  const pageSize = 30;
  const [browseBy, setBrowseBy] = useState<BrowseBy>(loadBrowseBy);
  const [categories, setCategories] = useState<Category[]>([]);
  const [locationRecords, setLocationRecords] = useState<Location[]>([]);
  const [allInventory, setAllInventory] = useState<InventoryItem[]>([]);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [shelfFolderId, setShelfFolderId] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const [inboundPreset, setInboundPreset] = useState<DateRangePreset>("all");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [filterCategoryId, setFilterCategoryId] = useState<string | null>(null);
  const [filterLocationId, setFilterLocationId] = useState<string>("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [items, setItems] = useState<MaterialSearchItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";

  const stockActions =
    user?.role === "ADMIN" || user?.role === "KEEPER"
      ? [
          { text: "出库", key: "outbound" },
          { text: "入库", key: "inbound" },
          { text: "移动", key: "transfer" },
          ...(isAdmin
            ? [
                { text: "进货", key: "purchase" },
                { text: "编辑", key: "edit" },
              ]
            : []),
        ]
      : [
          { text: "申请出库", key: "req-outbound" },
          { text: "申请入库", key: "req-inbound" },
        ];

  const categoryOptions = useMemo(
    () => [{ label: "不限", value: "" }, ...categories.map((c) => ({ label: c.name, value: c.id }))],
    [categories],
  );

  const locationOptions = useMemo(
    () => [{ label: "不限", value: "" }, ...locationRecords.map((l) => ({ label: l.name, value: l.id }))],
    [locationRecords],
  );

  const hasSearchQuery = useMemo(
    () =>
      Boolean(
        keyword.trim() ||
          stockFilter !== "all" ||
          inboundPreset !== "all" ||
          filterCategoryId ||
          filterLocationId,
      ),
    [keyword, stockFilter, inboundPreset, filterCategoryId, filterLocationId],
  );

  const activeFilterCount = [
    stockFilter !== "all",
    inboundPreset !== "all",
    filterCategoryId,
    filterLocationId,
  ].filter(Boolean).length;

  const onBrowseByChange = (next: BrowseBy) => {
    setBrowseBy(next);
    localStorage.setItem("home_browse_by", next);
    setFolderId(null);
    setShelfFolderId(null);
  };

  const openShelfLocation = (loc: Location) => {
    if (isGridCapableLocation(loc)) {
      navigate(`/shelves/${loc.id}`);
      return;
    }
    if (getLocationChildren(locationRecords, loc.id).length > 0) {
      setShelfFolderId(loc.id);
      return;
    }
    navigate(`/shelves/${loc.id}`);
  };

  const loadCategories = useCallback(async () => {
    const data = await listCategories();
    setCategories(data);
  }, []);

  const loadSearchResults = useCallback(async () => {
    setLoading(true);
    try {
      const q = keyword.trim();

      if (stockFilter === "low") {
        let lowItems = await listLowStock();
        if (filterCategoryId) {
          lowItems = lowItems.filter((m) => getDescendantIds(categories, filterCategoryId).has(m.category_id));
        }
        setItems(lowItems);
        setPage(1);
        setTotal(lowItems.length);
        return;
      }

      let inboundMaterialIds: Set<string> | null = null;
      if (inboundPreset !== "all") {
        const range = resolveDateRange(inboundPreset, customStart, customEnd);
        const txs = await listTransactions({ ...range, limit: 500 });
        inboundMaterialIds = new Set(
          txs.filter((t) => t.type.includes("入")).map((t) => t.material_id),
        );
      }

      const data = await searchMaterials(q, {
        page: 1,
        size: pageSize,
        searchBy: "all",
        category: filterCategoryId ?? undefined,
        location: filterLocationId || undefined,
        stockOnly: stockFilter === "instock",
      });

      let nextItems = data.items;
      if (inboundMaterialIds) {
        nextItems = nextItems.filter((m) => inboundMaterialIds!.has(m.id));
      }

      setItems(nextItems);
      setPage(1);
      setTotal(inboundMaterialIds ? nextItems.length : data.total);
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "加载失败" });
    } finally {
      setLoading(false);
    }
  }, [
    categories,
    customEnd,
    customStart,
    filterCategoryId,
    filterLocationId,
    inboundPreset,
    keyword,
    stockFilter,
  ]);

  const loadCategoryBrowseResults = useCallback(async () => {
    if (!folderId) return;

    setLoading(true);
    try {
      const data = await searchMaterials("", {
        page: 1,
        size: pageSize,
        category: folderId,
      });
      setItems(data.items);
      setPage(1);
      setTotal(data.total);
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "加载失败" });
    } finally {
      setLoading(false);
    }
  }, [folderId]);

  const loadMore = useCallback(async () => {
    if (!hasSearchQuery || stockFilter === "low") return;
    setLoading(true);
    try {
      const data = await searchMaterials(keyword.trim(), {
        page: page + 1,
        size: pageSize,
        category: filterCategoryId ?? undefined,
        location: filterLocationId || undefined,
        stockOnly: stockFilter === "instock",
      });
      setItems((cur) => [...cur, ...data.items]);
      setPage(data.page);
      setTotal(data.total);
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "加载失败" });
    } finally {
      setLoading(false);
    }
  }, [filterCategoryId, filterLocationId, hasSearchQuery, keyword, page, stockFilter]);

  useEffect(() => {
    const state = location.state as { browseBy?: BrowseBy } | null;
    if (state?.browseBy === "location") {
      setBrowseBy("location");
      localStorage.setItem("home_browse_by", "location");
    }
  }, [location.state]);

  useEffect(() => {
    if (location.pathname !== "/") return;
    void loadCategories();
    void Promise.all([listLocations(), listInventory()])
      .then(([locs, inv]) => {
        setLocationRecords(locs);
        setAllInventory(inv);
      })
      .catch(() => {
        setLocationRecords([]);
        setAllInventory([]);
      });
  }, [location.pathname, location.key, loadCategories]);

  useEffect(() => {
    if (location.pathname !== "/") return;

    if (hasSearchQuery) {
      void loadSearchResults();
      return;
    }

    if (browseBy === "category") {
      if (!folderId) {
        setItems([]);
        setTotal(0);
        return;
      }
      void loadCategoryBrowseResults();
    }
  }, [
    location.pathname,
    location.key,
    hasSearchQuery,
    browseBy,
    folderId,
    keyword,
    stockFilter,
    inboundPreset,
    customStart,
    customEnd,
    filterCategoryId,
    filterLocationId,
    loadSearchResults,
    loadCategoryBrowseResults,
  ]);

  const handleMaterialAction = (id: string, key: string) => {
    switch (key) {
      case "outbound":
      case "req-outbound":
        navigate(`/stock?material_id=${id}`);
        break;
      case "inbound":
      case "req-inbound":
        navigate(`/stock?tab=inbound&material_id=${id}`);
        break;
      case "transfer":
        navigate(`/stock?tab=transfer&material_id=${id}`);
        break;
      case "edit":
        navigate(`/materials/${id}`);
        break;
      case "purchase":
        navigate(`/purchase?material_id=${id}`);
        break;
    }
  };

  const materialList = (
    <>
      {!loading && items.length === 0 && (
        <EmptyState
          icon={hasSearchQuery ? "📭" : "📁"}
          text={hasSearchQuery ? "没有匹配的物料" : "此分类下暂无物料"}
          hint={hasSearchQuery ? "换个关键词或调整筛选试试" : "可返回上级选其他分类"}
        />
      )}
      {items.map((m) => {
        const isLowStock = m.total_quantity < (m.min_stock ?? 5);
        return (
          <MaterialCard
            key={m.id}
            name={m.name}
            category={[m.major_category, m.sub_category ?? m.category_name].filter(Boolean).join(" / ") || m.category_name}
            quantity={m.total_quantity}
            warning={isLowStock ? "low" : undefined}
            stockSummary={m.locations_summary ?? undefined}
            onClick={() => navigate(`/materials/${m.id}`)}
            inlineCount={2}
            actions={stockActions}
            onAction={(action) => handleMaterialAction(m.id, String(action.key))}
          />
        );
      })}
      {hasSearchQuery && items.length < total && stockFilter !== "low" && (
        <div className="load-more">
          <Button loading={loading} fill="outline" block onClick={() => void loadMore()}>
            加载更多
          </Button>
        </div>
      )}
    </>
  );

  const searchAndFilters = (
    <>
      <div className="search-bar-wrap">
        <input
          className="search-input-native"
          type="search"
          enterKeyHint="search"
          placeholder="搜名称 / 编码 / 条码"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        {keyword && (
          <button type="button" className="search-input-clear" onClick={() => setKeyword("")} aria-label="清除">
            ×
          </button>
        )}
      </div>
      <button type="button" className="filter-toggle-btn" onClick={() => setFiltersOpen((v) => !v)}>
        筛选{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""} {filtersOpen ? "▲" : "▼"}
      </button>
      {filtersOpen && (
        <div className="list-filters">
          <div className="filter-row">
            <span className="filter-row-label">库存</span>
            <Selector
              className="filter-selector"
              options={STOCK_OPTIONS}
              value={[stockFilter]}
              onChange={(arr) => setStockFilter((arr[0] as StockFilter | undefined) ?? "all")}
            />
          </div>
          <div className="filter-row">
            <span className="filter-row-label">入库时间</span>
            <Selector
              className="filter-selector"
              options={INBOUND_TIME_OPTIONS}
              value={[inboundPreset]}
              onChange={(arr) => setInboundPreset((arr[0] as DateRangePreset | undefined) ?? "all")}
            />
          </div>
          {inboundPreset === "custom" && (
            <div className="history-date-row">
              <label className="history-date-field">
                <span>从</span>
                <input className="native-date-input" type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
              </label>
              <label className="history-date-field">
                <span>至</span>
                <input className="native-date-input" type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
              </label>
            </div>
          )}
          <div className="filter-row">
            <span className="filter-row-label">分类</span>
            <Selector
              className="filter-selector"
              options={categoryOptions}
              value={[filterCategoryId ?? ""]}
              onChange={(arr) => setFilterCategoryId((arr[0] as string) || null)}
            />
          </div>
          <div className="filter-row">
            <span className="filter-row-label">库位</span>
            <Selector
              className="filter-selector"
              options={locationOptions.length ? locationOptions : [{ label: "不限", value: "" }]}
              value={[filterLocationId]}
              onChange={(arr) => setFilterLocationId((arr[0] as string | undefined) ?? "")}
            />
          </div>
        </div>
      )}
    </>
  );

  return (
    <Layout title="首页">
      <SectionCard className="flush-body home-search-card">
        {searchAndFilters}
        {!hasSearchQuery && (
          <div className="home-mode-switch" role="tablist" aria-label="浏览方式">
              <button
                type="button"
                role="tab"
                aria-selected={browseBy === "category"}
                className={`home-mode-btn ${browseBy === "category" ? "home-mode-btn-active" : ""}`}
                onClick={() => onBrowseByChange("category")}
              >
                按分类
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={browseBy === "location"}
                className={`home-mode-btn ${browseBy === "location" ? "home-mode-btn-active" : ""}`}
                onClick={() => onBrowseByChange("location")}
              >
                按货架
              </button>
            </div>
        )}
      </SectionCard>

      {hasSearchQuery ? (
        <SectionCard title={loading && items.length === 0 ? "搜索中…" : `搜索结果 · 共 ${total} 种`}>
          {materialList}
        </SectionCard>
      ) : browseBy === "category" ? (
        <>
          <SectionCard className="flush-body home-section-card">
            <CategoryFolderBrowser
              categories={categories}
              folderId={folderId}
              onOpenFolder={setFolderId}
              onNavigate={setFolderId}
            />
          </SectionCard>
          {folderId && (
            <SectionCard title={loading ? "加载中…" : `物料 ${total} 种`}>
              {materialList}
            </SectionCard>
          )}
        </>
      ) : (
        <SectionCard className="flush-body home-section-card">
          {locationRecords.length === 0 ? (
            <EmptyState icon="📍" text="暂无货架/货柜" hint="请先在「管理 → 库位」中维护" />
          ) : (
            <StorageUnitPicker
                locations={locationRecords}
                inventory={allInventory}
                folderId={shelfFolderId}
                onSelect={openShelfLocation}
                onNavigate={setShelfFolderId}
              />
          )}
        </SectionCard>
      )}
    </Layout>
  );
}
