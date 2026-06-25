import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Form, Input, SearchBar, Selector, Toast } from "antd-mobile";
import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import {
  listMyRequests,
  searchMaterials,
} from "../api";
import type { Category, StockRequest, StockRequestStatus } from "../api/types";
import { fetchCategoriesCached } from "../utils/cachedApi";
import { prefetchModule } from "../utils/dataCache";
import { formatReturnPlan } from "../utils/requestDisplay";
import {
  DateRangePreset,
  TxTypeFilter,
  formatHistoryDate,
  parsePipeRemark,
  sortRequestsByPriority,
} from "../utils/historyDisplay";
import { buildTransactionQueryParams, type TransactionQueryState } from "../utils/transactionQuery";
import { openMaterialDetail } from "../utils/detailNavigation";
import { useAuth } from "../components/AuthGate";
import { Layout } from "../components/Layout";
import { PendingReturnsPanel } from "../components/PendingReturnsPanel";
import { PendingClosuresPanel } from "../components/PendingClosuresPanel";
import { ApprovalRecords } from "../components/ApprovalRecords";
import { EmptyState, SectionCard, TxBadge } from "../components/ui";

interface SearchSuggestion {
  label: string;
  value: string;
  hint: string;
}

type RequestView = StockRequestStatus | "ALL";
type StaffHistoryView = "transactions" | "returns" | "approvals" | "closures";
type UserHistoryView = "requests" | "returns" | "transactions" | "closures";

const REQUEST_VIEW_OPTIONS: Array<{ label: string; value: RequestView }> = [
  { label: "进行中", value: "待审批" },
  { label: "已拒绝", value: "已拒绝" },
  { label: "已通过", value: "已通过" },
  { label: "全部", value: "ALL" },
];

const DATE_PRESET_OPTIONS: Array<{ label: string; value: DateRangePreset }> = [
  { label: "全部", value: "all" },
  { label: "近7天", value: "7d" },
  { label: "近30天", value: "30d" },
  { label: "自定义", value: "custom" },
];

const TX_TYPE_OPTIONS: Array<{ label: string; value: TxTypeFilter }> = [
  { label: "全部类型", value: "ALL" },
  { label: "入库", value: "入库" },
  { label: "出库", value: "出库" },
  { label: "移动", value: "移动" },
];

function requestViewHint(view: RequestView): string {
  if (view === "待审批") return "等待管理员审批的申请会显示在这里";
  if (view === "已拒绝") return "被拒绝的申请及原因会显示在这里";
  if (view === "已通过") return "审批通过的申请记录；实际库存变更见下方流水";
  return "全部申请记录；已通过项也可在流水中查看";
}

export default function HistoryPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { canApprove, canInbound, pendingCount, user } = useAuth();
  const staffHistoryOptions = useMemo(() => {
    const opts: Array<{ label: string; value: StaffHistoryView }> = [];
    if (canApprove) {
      opts.push({
        label: pendingCount > 0 ? `审批 (${pendingCount})` : "审批",
        value: "approvals",
      });
    }
    opts.push({ label: "流水", value: "transactions" });
    if (canInbound) {
      opts.push({ label: "待归还", value: "returns" });
      opts.push({ label: "结案", value: "closures" });
    }
    return opts;
  }, [canInbound, canApprove, pendingCount]);

  const userHistoryOptions: Array<{ label: string; value: UserHistoryView }> = [
    { label: "我的申请", value: "requests" },
    { label: "待归还", value: "returns" },
    { label: "结案申请", value: "closures" },
    { label: "流水", value: "transactions" },
  ];

  const resolveStaffView = (): StaffHistoryView => {
    const view = searchParams.get("view");
    if (view === "returns") return "returns";
    if (view === "closures") return "closures";
    if (view === "approvals" && canApprove) return "approvals";
    if (view === "transactions") return "transactions";
    if (canApprove && pendingCount > 0) return "approvals";
    return "transactions";
  };

  const resolveUserView = (): UserHistoryView => {
    const view = searchParams.get("view");
    if (view === "returns") return "returns";
    if (view === "closures") return "closures";
    if (view === "transactions") return "transactions";
    return "requests";
  };

  const [staffView, setStaffView] = useState<StaffHistoryView>(resolveStaffView);
  const [userView, setUserView] = useState<UserHistoryView>(resolveUserView);
  const [requests, setRequests] = useState<StockRequest[]>([]);
  const [keyword, setKeyword] = useState(() => searchParams.get("q") ?? "");
  const [requestView, setRequestView] = useState<RequestView>("待审批");
  const [categories, setCategories] = useState<Category[]>([]);
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [operatorSuggestions, setOperatorSuggestions] = useState<SearchSuggestion[]>([]);
  const [operator, setOperator] = useState("");
  const [datePreset, setDatePreset] = useState<DateRangePreset>("all");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");
  const [txTypeFilter, setTxTypeFilter] = useState<TxTypeFilter>("ALL");
  const [advancedFiltersExpanded, setAdvancedFiltersExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [everMounted, setEverMounted] = useState<Record<string, boolean>>(() => ({
    transactions: true,
    requests: !canInbound,
    approvals: canApprove && pendingCount > 0,
    returns: false,
    closures: false,
  }));

  useEffect(() => {
    if (canInbound) {
      setStaffView(resolveStaffView());
    } else {
      setUserView(resolveUserView());
    }
  }, [canInbound, canApprove, pendingCount, searchParams]);

  useEffect(() => {
    if (!canApprove || searchParams.get("view")) return;
    if (pendingCount > 0) {
      setStaffView("approvals");
    }
  }, [canApprove, pendingCount, searchParams]);

  const setStaffHistoryView = (view: StaffHistoryView) => {
    setStaffView(view);
    if (view === "returns") {
      setSearchParams({ view: "returns" }, { replace: true });
    } else if (view === "closures") {
      setSearchParams({ view: "closures" }, { replace: true });
    } else if (view === "approvals") {
      setSearchParams({ view: "approvals" }, { replace: true });
    } else {
      setSearchParams({}, { replace: true });
    }
  };

  const setUserHistoryView = (view: UserHistoryView) => {
    setUserView(view);
    if (view === "returns") {
      setSearchParams({ view: "returns" }, { replace: true });
    } else if (view === "closures") {
      setSearchParams({ view: "closures" }, { replace: true });
    } else if (view === "transactions") {
      setSearchParams({ view: "transactions" }, { replace: true });
    } else {
      setSearchParams({}, { replace: true });
    }
  };

  const showReturnsView = (canInbound && staffView === "returns") || (!canInbound && userView === "returns");
  const showClosuresView =
    (canInbound && staffView === "closures") || (!canInbound && userView === "closures");
  const showUserRequests = !canInbound && userView === "requests";
  const showUserTransactions = !canInbound && userView === "transactions";
  const showStaffTransactions = canInbound && staffView === "transactions";
  const trimmedKeyword = keyword.trim();

  const goToTransactionResults = () => {
    navigateTx(getTxQueryState());
  };

  const getTxQueryState = (overrides?: Partial<TransactionQueryState>): TransactionQueryState => ({
    keyword,
    txType: txTypeFilter,
    operator,
    locationId: "",
    datePreset,
    customStartDate,
    customEndDate,
    page: 1,
    ...overrides,
  });

  const navigateTx = (state: TransactionQueryState) => {
    navigate(`/history/transactions?${buildTransactionQueryParams(state).toString()}`);
  };

  const syncTxFilterState = (state: TransactionQueryState) => {
    setKeyword(state.keyword);
    setTxTypeFilter(state.txType);
    setOperator(state.operator);
    setDatePreset(state.datePreset);
    setCustomStartDate(state.customStartDate);
    setCustomEndDate(state.customEndDate);
    setSuggestions([]);
    setOperatorSuggestions([]);
  };

  const applyTxPreset = (preset: "7d" | "7d-out" | "mine") => {
    const overrides =
      preset === "7d"
        ? { datePreset: "7d" as const, txType: "ALL" as const, operator: "", customStartDate: "", customEndDate: "" }
        : preset === "7d-out"
          ? { datePreset: "7d" as const, txType: "出库" as const, operator: "", customStartDate: "", customEndDate: "" }
          : {
              datePreset: "7d" as const,
              txType: "ALL" as const,
              operator: user?.name ?? "",
              customStartDate: "",
              customEndDate: "",
            };
    const next = getTxQueryState(overrides);
    syncTxFilterState(next);
    navigateTx(next);
  };

  const clearAllTxFilters = () => {
    const next = getTxQueryState({
      keyword: "",
      txType: "ALL",
      operator: "",
      datePreset: "all",
      customStartDate: "",
      customEndDate: "",
    });
    syncTxFilterState(next);
  };

  const hasActiveTxFilters =
    Boolean(trimmedKeyword) ||
    txTypeFilter !== "ALL" ||
    (canApprove && (datePreset !== "all" || Boolean(operator.trim())));

  const activePreset =
    datePreset === "7d" && !operator.trim() && !trimmedKeyword
      ? txTypeFilter === "出库"
        ? "7d-out"
        : txTypeFilter === "ALL"
          ? "7d"
          : null
      : datePreset === "7d" && txTypeFilter === "ALL" && operator.trim() === (user?.name ?? "").trim() && !trimmedKeyword
        ? "mine"
        : null;

  const loadRequests = useCallback(async (nextKeyword = keyword) => {
    if (canInbound) return;
    setLoading(true);
    try {
      const search = nextKeyword.trim() || undefined;
      const reqData = await listMyRequests({
        limit: 100,
        keyword: search,
        status: requestView === "ALL" ? undefined : requestView,
      });
      setRequests(sortRequestsByPriority(reqData));
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "加载申请失败" });
    } finally {
      setLoading(false);
    }
  }, [canInbound, keyword, requestView]);

  useEffect(() => {
    if (showUserRequests) void loadRequests();
  }, [loadRequests, showUserRequests]);

  useEffect(() => {
    const tab = canInbound ? staffView : userView;
    setEverMounted((prev) => (prev[tab] ? prev : { ...prev, [tab]: true }));
  }, [canInbound, staffView, userView]);

  useEffect(() => {
    if (showStaffTransactions || showUserTransactions) {
      prefetchModule(() => import("./HistoryTransactionResults"));
    }
  }, [showStaffTransactions, showUserTransactions]);

  useEffect(() => {
    void fetchCategoriesCached()
      .then(setCategories)
      .catch(() => setCategories([]));
  }, []);

  const categorySuggestionPool = useMemo(() => {
    const seen = new Set<string>();
    const result: SearchSuggestion[] = [];
    for (const category of categories) {
      const major = category.major_name || category.name;
      const sub = category.sub_name || category.name;
      const full = major && sub && major !== sub ? `${major} / ${sub}` : sub;
      for (const item of [
        { label: full, value: sub, hint: major ? `分类 · ${major}` : "分类" },
        { label: major, value: major, hint: "大类" },
      ]) {
        if (!item.label || seen.has(item.label)) continue;
        seen.add(item.label);
        result.push(item);
      }
    }
    return result;
  }, [categories]);

  useEffect(() => {
    const text = trimmedKeyword.toLowerCase();
    if (!text) {
      setSuggestions([]);
      return;
    }

    const timer = window.setTimeout(() => {
      const categoryMatches = categorySuggestionPool
        .filter((item) => item.label.toLowerCase().includes(text) || item.value.toLowerCase().includes(text))
        .slice(0, 5);

      void searchMaterials(trimmedKeyword, { page: 1, size: 5, searchBy: "all" })
        .then((data) => {
          const seen = new Set(categoryMatches.map((item) => item.value));
          const next: SearchSuggestion[] = [...categoryMatches];
          for (const item of data.items) {
            if (!item.name || seen.has(item.name)) continue;
            seen.add(item.name);
            next.push({
              label: item.name,
              value: item.name,
              hint: [item.major_category, item.mid_category, item.sub_category]
                .filter(Boolean)
                .join(" / ") || (item.category_name ?? item.code),
            });
            if (next.length >= 5) break;
          }
          setSuggestions(next.slice(0, 5));
        })
        .catch(() => setSuggestions(categoryMatches));
    }, 220);

    return () => window.clearTimeout(timer);
  }, [categorySuggestionPool, trimmedKeyword]);

  const memberSuggestionPool = useMemo(() => {
    const seen = new Set<string>();
    const result: SearchSuggestion[] = [];
    for (const req of requests) {
      if (!req.requester_name || req.requester_name === "未知" || seen.has(req.requester_name)) continue;
      seen.add(req.requester_name);
      result.push({ label: req.requester_name, value: req.requester_name, hint: "申请人" });
    }
    return result;
  }, [requests]);

  useEffect(() => {
    if (!canApprove) {
      setOperatorSuggestions([]);
      return;
    }
    const text = operator.trim().toLowerCase();
    if (!text) {
      setOperatorSuggestions([]);
      return;
    }
    setOperatorSuggestions(
      memberSuggestionPool
        .filter((item) => item.label.toLowerCase().includes(text) || item.value.toLowerCase().includes(text))
        .slice(0, 5),
    );
  }, [canApprove, memberSuggestionPool, operator]);

  const chooseSuggestion = (suggestion: SearchSuggestion) => {
    setKeyword(suggestion.value);
    setSuggestions([]);
  };

  const chooseOperatorSuggestion = (suggestion: SearchSuggestion) => {
    setOperator(suggestion.value);
    setOperatorSuggestions([]);
  };

  const openMaterial = (materialId: string) => {
    if (!materialId) return;
    const backTo = `${location.pathname}${location.search}`;
    openMaterialDetail(navigate, materialId, { backTo });
  };

  return (
    <>
    <Layout title="历史">
      {canApprove && pendingCount > 0 && (
        <div className="history-pending-banner">
          <span>待审批 {pendingCount} 条，管理员可在下方审批记录中处理</span>
          <Button
            size="small"
            color="primary"
            fill="outline"
            onClick={() => setStaffHistoryView("approvals")}
          >
            查看记录
          </Button>
        </div>
      )}

      {canInbound ? (
        <Selector
          className="view-tabs sticky-subnav"
          options={staffHistoryOptions}
          value={[staffView]}
          onChange={(arr) =>
            setStaffHistoryView((arr[0] as StaffHistoryView | undefined) ?? "transactions")
          }
        />
      ) : (
        <Selector
          className="view-tabs sticky-subnav"
          options={userHistoryOptions}
          value={[userView]}
          onChange={(arr) => setUserHistoryView((arr[0] as UserHistoryView | undefined) ?? "requests")}
        />
      )}

      {everMounted.approvals && canApprove && (
        <div className="history-tab-pane" hidden={staffView !== "approvals"}>
          <ApprovalRecords active={staffView === "approvals"} />
        </div>
      )}

      {everMounted.returns && (
        <div className="history-tab-pane" hidden={!showReturnsView}>
          <PendingReturnsPanel active={showReturnsView} showBorrowerFilter={canInbound} />
        </div>
      )}

      {everMounted.closures && (
        <div className="history-tab-pane" hidden={!showClosuresView}>
          <PendingClosuresPanel active={showClosuresView} showActions={canInbound} />
        </div>
      )}

      {(showStaffTransactions || showUserTransactions) && (
      <SectionCard
        title={canApprove ? "出入库流水" : "我的流水"}
        subtitle={canApprove ? undefined : undefined}
      >
        <SearchBar
          placeholder="搜索物品 / 库位 / 备注"
          value={keyword}
          onChange={setKeyword}
          onSearch={goToTransactionResults}
          onClear={() => {
            setKeyword("");
            setSuggestions([]);
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

        {(showStaffTransactions || showUserTransactions) && (
          <div className="filter-quick-row history-tx-quick">
            <span className="filter-quick-label">类型</span>
            {TX_TYPE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`filter-quick-chip ${txTypeFilter === opt.value ? "filter-quick-chip-active" : ""}`}
                onClick={() => setTxTypeFilter(opt.value)}
              >
                {opt.value === "ALL" ? "全部" : opt.label}
              </button>
            ))}
          </div>
        )}

        {canApprove && (showStaffTransactions || showUserTransactions) && (
          <div className="filter-quick-row history-tx-presets">
            <span className="filter-quick-label">快捷</span>
            <button
              type="button"
              className={`filter-quick-chip ${activePreset === "7d" ? "filter-quick-chip-active" : ""}`}
              onClick={() => applyTxPreset("7d")}
            >
              近7天
            </button>
            <button
              type="button"
              className={`filter-quick-chip ${activePreset === "7d-out" ? "filter-quick-chip-active" : ""}`}
              onClick={() => applyTxPreset("7d-out")}
            >
              近7天出库
            </button>
            {user?.name ? (
              <button
                type="button"
                className={`filter-quick-chip ${activePreset === "mine" ? "filter-quick-chip-active" : ""}`}
                onClick={() => applyTxPreset("mine")}
              >
                我的操作
              </button>
            ) : null}
          </div>
        )}

        {canApprove && (showStaffTransactions || showUserTransactions) && (
          <>
            <button
              type="button"
              className="history-advanced-toggle"
              onClick={() => setAdvancedFiltersExpanded((v) => !v)}
            >
              {advancedFiltersExpanded ? "收起高级筛选 ▲" : "高级筛选（时间 / 成员）▼"}
            </button>
            {advancedFiltersExpanded && (
              <div className="history-admin-quick">
                <Form.Item label="时间范围">
                  <Selector
                    options={DATE_PRESET_OPTIONS}
                    value={[datePreset]}
                    onChange={(arr) => {
                      const next = (arr[0] as DateRangePreset | undefined) ?? "all";
                      setDatePreset(next);
                      if (next !== "custom") {
                        setCustomStartDate("");
                        setCustomEndDate("");
                      }
                    }}
                  />
                </Form.Item>
                {datePreset === "custom" && (
                  <div className="history-date-row">
                    <label className="history-date-field">
                      <span>开始</span>
                      <input
                        className="native-date-input"
                        type="date"
                        value={customStartDate}
                        onChange={(e) => setCustomStartDate(e.target.value)}
                      />
                    </label>
                    <label className="history-date-field">
                      <span>结束</span>
                      <input
                        className="native-date-input"
                        type="date"
                        value={customEndDate}
                        onChange={(e) => setCustomEndDate(e.target.value)}
                      />
                    </label>
                  </div>
                )}
                <Form layout="vertical" className="form-card history-filters">
                  <Form.Item label="成员（操作人）">
                    <Input
                      value={operator}
                      onChange={setOperator}
                      placeholder="输入成员姓名后匹配"
                      clearable
                    />
                    {operatorSuggestions.length > 0 && (
                      <div className="search-suggestions member-suggestions">
                        {operatorSuggestions.map((suggestion) => (
                          <button
                            key={`${suggestion.hint}-${suggestion.value}`}
                            type="button"
                            className="search-suggestion"
                            onClick={() => chooseOperatorSuggestion(suggestion)}
                          >
                            <span className="search-suggestion-label">{suggestion.label}</span>
                            <span className="search-suggestion-hint">{suggestion.hint}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </Form.Item>
                </Form>
              </div>
            )}
          </>
        )}

        <Button block color="primary" onClick={goToTransactionResults}>
          查询流水
        </Button>

        {hasActiveTxFilters && (
          <div className="history-active-filters">
            {trimmedKeyword && (
              <button
                type="button"
                className="history-filter-tag"
                onClick={() => {
                  setKeyword("");
                  setSuggestions([]);
                }}
              >
                关键词：{trimmedKeyword} ×
              </button>
            )}
            {txTypeFilter !== "ALL" && (
              <button type="button" className="history-filter-tag" onClick={() => setTxTypeFilter("ALL")}>
                类型：{txTypeFilter} ×
              </button>
            )}
            {canApprove && datePreset !== "all" && (
              <button
                type="button"
                className="history-filter-tag"
                onClick={() => {
                  setDatePreset("all");
                  setCustomStartDate("");
                  setCustomEndDate("");
                }}
              >
                时间：
                {datePreset === "7d"
                  ? "近7天"
                  : datePreset === "30d"
                    ? "近30天"
                    : `${customStartDate || "…"} ~ ${customEndDate || "…"}`}{" "}
                ×
              </button>
            )}
            {canApprove && operator.trim() && (
              <button type="button" className="history-filter-tag" onClick={() => setOperator("")}>
                成员：{operator.trim()} ×
              </button>
            )}
            <button type="button" className="history-filter-clear-all" onClick={clearAllTxFilters}>
              清除全部
            </button>
          </div>
        )}
      </SectionCard>
      )}

      {everMounted.requests && !canInbound && (
        <div className="history-tab-pane" hidden={!showUserRequests}>
        <SectionCard
          title={loading ? "我的申请 · 加载中…" : `我的申请 ${requests.length} 条`}
          subtitle={requestViewHint(requestView)}
        >
          <SearchBar
            placeholder="搜索物料名称"
            value={keyword}
            onChange={setKeyword}
            onSearch={() => void loadRequests()}
            onClear={() => {
              setKeyword("");
              void loadRequests("");
            }}
          />
          <Selector
            className="history-request-tabs"
            options={REQUEST_VIEW_OPTIONS}
            value={[requestView]}
            onChange={(arr) => setRequestView((arr[0] as RequestView | undefined) ?? "待审批")}
          />
          {requests.length === 0 ? (
            <EmptyState
              icon="list"
              text={trimmedKeyword ? `未找到与「${trimmedKeyword}」相关的申请` : "暂无申请记录"}
              hint={trimmedKeyword ? "试试清空搜索或切换筛选" : requestViewHint(requestView)}
            />
          ) : (
            requests.map((item) => {
              const parsed = parsePipeRemark(item.remark);
              return (
                <div className="request-item" key={item.id}>
                  <div className="request-item-header">
                    <TxBadge type={item.type} />
                    <span className={`request-status request-status-${item.status}`}>{item.status}</span>
                  </div>
                  <button
                    type="button"
                    className="history-link-title request-title"
                    onClick={() => openMaterial(item.material_id)}
                  >
                    {item.material_name ?? item.material_id} × {item.quantity}
                  </button>
                  <div className="tx-meta">
                    {item.type === "入库" && !item.location_id
                      ? "库位待库管指定"
                      : (item.location_name ?? item.location_id ?? "—")}{" "}
                    · {formatHistoryDate(item.created_at)}
                  </div>
                  {parsed.note && <div className="tx-meta">说明：{parsed.note}</div>}
                  {parsed.slot && <div className="tx-meta">格位：{parsed.slot}</div>}
                  {(parsed.returnPlan || formatReturnPlan(item)) && (
                    <div className="tx-meta">归还：{parsed.returnPlan ?? formatReturnPlan(item)}</div>
                  )}
                  {item.approver_name && <div className="tx-meta">审批人：{item.approver_name}</div>}
                  {item.reject_reason && (
                    <div className="tx-meta">拒绝原因：{parsePipeRemark(item.reject_reason).note}</div>
                  )}
                </div>
              );
            })
          )}
        </SectionCard>
        </div>
      )}
    </Layout>
    </>
  );
}
