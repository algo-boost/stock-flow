import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Selector, Toast } from "antd-mobile";
import { useLocation, useNavigate } from "react-router-dom";
import { searchMaterials } from "../api";
import type { Category, InventoryItem, Location, MaterialSearchItem } from "../api/types";
import { fetchHomeMetaCached, fetchInboundMaterialIdsCached } from "../utils/cachedApi";
import { CategoryFolderBrowser } from "../components/CategoryFolderBrowser";
import { StorageUnitPicker } from "../components/StorageUnitPicker";
import { useAuth } from "../components/AuthGate";
import { Layout } from "../components/Layout";
import { CardSkeleton, EmptyState, MaterialCard, SectionCard, ShelfGridSkeleton } from "../components/ui";
import type { DateRangePreset } from "../utils/historyDisplay";
import { getLocationChildren } from "../utils/locationTree";
import { isGridCapableLocation } from "../utils/shelfGrid";
import { openMaterialDetail } from "../utils/detailNavigation";

type BrowseBy = "category" | "location";
type StockFilter = "all" | "instock" | "out" | "lowstock";

const STOCK_OPTIONS: Array<{ label: string; value: StockFilter }> = [
  { label: "全部", value: "all" },
  { label: "有库存", value: "instock" },
  { label: "缺货", value: "out" },
  { label: "低库存", value: "lowstock" },
];

const INBOUND_TIME_OPTIONS: Array<{ label: string; value: DateRangePreset }> = [
  { label: "不限", value: "all" },
  { label: "近7天", value: "7d" },
  { label: "近30天", value: "30d" },
  { label: "自定义", value: "custom" },
];

const SESSION_KEY = "sf_home_session";

function loadBrowseBy(): BrowseBy {
  try {
    const saved = localStorage.getItem("home_browse_by") ?? localStorage.getItem("home_view_mode");
    if (saved === "category") return "category";
    return "location";
  } catch {
    return "location";
  }
}

function loadShelfFolderId(): string | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as { shelfFolderId?: string | null };
    return data.shelfFolderId ?? null;
  } catch {
    return null;
  }
}

function saveHomeSession(shelfFolderId: string | null) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ shelfFolderId }));
  } catch {
    /* ignore */
  }
}

export default function SearchPage() {
  const pageSize = 30;
  const [browseBy, setBrowseBy] = useState<BrowseBy>(loadBrowseBy);
  const [categories, setCategories] = useState<Category[]>([]);
  const [locationRecords, setLocationRecords] = useState<Location[]>([]);
  const [allInventory, setAllInventory] = useState<InventoryItem[]>([]);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [shelfFolderId, setShelfFolderId] = useState<string | null>(loadShelfFolderId);
  const [metaLoading, setMetaLoading] = useState(true);
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
  const canInbound = user?.role === "KEEPER" || user?.role === "ADMIN";

  const stockActions =
    canInbound
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

  const activeFilterTags = useMemo(() => {
    const tags: Array<{ key: string; label: string; onClear: () => void }> = [];
    if (keyword.trim()) {
      tags.push({ key: "kw", label: `「${keyword.trim()}」`, onClear: () => setKeyword("") });
    }
    if (stockFilter === "instock") {
      tags.push({ key: "stock", label: "有库存", onClear: () => setStockFilter("all") });
    }
    if (stockFilter === "out") {
      tags.push({ key: "out", label: "缺货", onClear: () => setStockFilter("all") });
    }
    if (stockFilter === "lowstock") {
      tags.push({ key: "lowstock", label: "低库存", onClear: () => setStockFilter("all") });
    }
    if (inboundPreset === "7d") {
      tags.push({ key: "7d", label: "近7天入库", onClear: () => setInboundPreset("all") });
    }
    if (inboundPreset === "30d") {
      tags.push({ key: "30d", label: "近30天入库", onClear: () => setInboundPreset("all") });
    }
    if (inboundPreset === "custom") {
      tags.push({ key: "custom", label: "自定义时间", onClear: () => setInboundPreset("all") });
    }
    if (filterCategoryId) {
      const name = categories.find((c) => c.id === filterCategoryId)?.name ?? "分类";
      tags.push({ key: "cat", label: name, onClear: () => setFilterCategoryId(null) });
    }
    if (filterLocationId) {
      const name = locationRecords.find((l) => l.id === filterLocationId)?.name ?? "库位";
      tags.push({ key: "loc", label: name, onClear: () => setFilterLocationId("") });
    }
    return tags;
  }, [categories, filterCategoryId, filterLocationId, inboundPreset, keyword, locationRecords, stockFilter]);

  const clearAllFilters = () => {
    setKeyword("");
    setStockFilter("all");
    setInboundPreset("all");
    setCustomStart("");
    setCustomEnd("");
    setFilterCategoryId(null);
    setFilterLocationId("");
  };

  const onBrowseByChange = (next: BrowseBy) => {
    setBrowseBy(next);
    localStorage.setItem("home_browse_by", next);
    setFolderId(null);
    setShelfFolderId(null);
    saveHomeSession(null);
  };

  const onShelfFolderNavigate = (id: string | null) => {
    setShelfFolderId(id);
    saveHomeSession(id);
  };

  const openShelfLocation = (loc: Location) => {
    if (isGridCapableLocation(loc)) {
      navigate(`/shelves/${loc.id}`);
      return;
    }
    if (getLocationChildren(locationRecords, loc.id).length > 0) {
      onShelfFolderNavigate(loc.id);
      return;
    }
    navigate(`/shelves/${loc.id}`);
  };

  const loadCategories = useCallback(async () => {
    const data = await fetchHomeMetaCached();
    setCategories(data.categories);
    setLocationRecords(data.locations);
    setAllInventory(data.inventory);
  }, []);

  const loadSearchResults = useCallback(async () => {
    setLoading(true);
    try {
      const q = keyword.trim();

      if (stockFilter === "out" || stockFilter === "lowstock") {
        const data = await searchMaterials(q, {
          page: 1,
          size: pageSize,
          searchBy: "all",
          category: filterCategoryId ?? undefined,
          location: filterLocationId || undefined,
          outOfStock: stockFilter === "out",
          lowStock: stockFilter === "lowstock",
        });
        setItems(data.items);
        setPage(1);
        setTotal(data.total);
        return;
      }

      let inboundMaterialIds: Set<string> | null = null;
      if (inboundPreset !== "all") {
        inboundMaterialIds = await fetchInboundMaterialIdsCached(inboundPreset, customStart, customEnd);
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
    if (!hasSearchQuery || stockFilter === "out" || stockFilter === "lowstock") return;
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
    const state = location.state as { browseBy?: BrowseBy; shelfFolderId?: string | null } | null;
    if (state?.browseBy === "location") {
      setBrowseBy("location");
      localStorage.setItem("home_browse_by", "location");
    }
    if (state?.shelfFolderId !== undefined) {
      setShelfFolderId(state.shelfFolderId);
      saveHomeSession(state.shelfFolderId);
    }
    const backFolderId = (state as { folderId?: string | null } | null)?.folderId;
    if (backFolderId !== undefined && state?.browseBy === "category") {
      setFolderId(backFolderId);
    }
  }, [location.state]);

  useEffect(() => {
    if (location.pathname !== "/") return;
    setMetaLoading(true);
    void loadCategories()
      .catch(() => {
        setCategories([]);
        setLocationRecords([]);
        setAllInventory([]);
      })
      .finally(() => setMetaLoading(false));
  }, [location.pathname, loadCategories]);

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

  const detailBackCtx = useMemo(
    () => ({
      backTo: "/",
      backState: { browseBy, shelfFolderId, folderId: browseBy === "category" ? folderId : null },
    }),
    [browseBy, shelfFolderId, folderId],
  );

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
        openMaterialDetail(navigate, id, detailBackCtx);
        break;
      case "purchase":
        navigate(`/purchase?material_id=${id}`);
        break;
    }
  };

  const materialList = (
    <>
      {loading && items.length === 0 && <CardSkeleton count={4} />}
      {!loading && items.length === 0 && (
        <EmptyState
          icon={hasSearchQuery ? "inbox" : "folder"}
          text={hasSearchQuery ? "没有匹配的物料" : "此分类下暂无物料"}
          hint={hasSearchQuery ? "可改关键词或去库位分类按货架找" : "可返回上级选其他分类"}
          actions={
            hasSearchQuery
              ? [
                  {
                    label: "清除筛选",
                    onClick: () => {
                      setKeyword("");
                      clearAllFilters();
                    },
                  },
                  {
                    label: "去按货架找",
                    onClick: () => {
                      setKeyword("");
                      onBrowseByChange("location");
                    },
                  },
                ]
              : undefined
          }
        />
      )}
      {items.map((m) => {
        const isOutOfStock = m.total_quantity <= 0;
        const isLowStock = !isOutOfStock && m.total_quantity < (m.min_stock ?? 5);
        return (
          <MaterialCard
            key={m.id}
            name={m.name}
            quantity={m.total_quantity}
            warning={isOutOfStock ? "out" : isLowStock ? "low" : undefined}
            stockSummary={m.locations_summary ?? undefined}
            code={m.code}
            onClick={() => openMaterialDetail(navigate, m.id, detailBackCtx)}
            inlineCount={1}
            actions={stockActions}
            onAction={(action) => handleMaterialAction(m.id, String(action.key))}
          />
        );
      })}
      {hasSearchQuery && items.length < total && stockFilter !== "out" && stockFilter !== "lowstock" && (
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

      <div className="filter-quick-row">
        <button
          type="button"
          className={`filter-quick-chip ${stockFilter === "instock" ? "filter-quick-chip-active" : ""}`}
          onClick={() => setStockFilter((v) => (v === "instock" ? "all" : "instock"))}
        >
          有库存
        </button>
        <button
          type="button"
          className={`filter-quick-chip ${stockFilter === "out" ? "filter-quick-chip-active" : ""}`}
          onClick={() => setStockFilter((v) => (v === "out" ? "all" : "out"))}
        >
          缺货
        </button>
        <button
          type="button"
          className={`filter-quick-chip ${stockFilter === "lowstock" ? "filter-quick-chip-active" : ""}`}
          onClick={() => setStockFilter((v) => (v === "lowstock" ? "all" : "lowstock"))}
        >
          低库存
        </button>
        <button
          type="button"
          className={`filter-quick-chip ${inboundPreset === "7d" ? "filter-quick-chip-active" : ""}`}
          onClick={() => setInboundPreset((v) => (v === "7d" ? "all" : "7d"))}
        >
          近7天入库
        </button>
        <button type="button" className="filter-more-btn" onClick={() => setFiltersOpen((v) => !v)}>
          更多{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
        </button>
      </div>

      {activeFilterTags.length > 0 && (
        <div className="active-filters-bar">
          {activeFilterTags.map((tag) => (
            <button key={tag.key} type="button" className="active-filter-tag" onClick={tag.onClear}>
              {tag.label} ×
            </button>
          ))}
          <button type="button" className="active-filter-clear" onClick={clearAllFilters}>
            清除全部
          </button>
        </div>
      )}

      {filtersOpen && (
        <div className="list-filters list-filters-advanced">
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
      <p className="home-scene-hint">搜名字找物料 · 点货架找位置</p>
      <SectionCard className="flush-body home-search-card sticky-subnav sticky-subnav-card">
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
              物料分类
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={browseBy === "location"}
              className={`home-mode-btn ${browseBy === "location" ? "home-mode-btn-active" : ""}`}
              onClick={() => onBrowseByChange("location")}
            >
              库位分类
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
          {metaLoading ? (
            <ShelfGridSkeleton />
          ) : locationRecords.length === 0 ? (
            <EmptyState icon="location" text="暂无货架/货柜" hint="请先在「管理 → 库位」中维护" />
          ) : (
            <StorageUnitPicker
              locations={locationRecords}
              inventory={allInventory}
              folderId={shelfFolderId}
              canInbound={canInbound}
              onSelect={openShelfLocation}
              onNavigate={onShelfFolderNavigate}
            />
          )}
        </SectionCard>
      )}
    </Layout>
  );
}
