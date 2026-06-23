import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Form, Input, SearchBar, Selector, Toast } from "antd-mobile";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  listApprovalRequests,
  listCategories,
  listMyRequests,
  listTransactions,
  searchMaterials,
} from "../api";
import type { Category, StockRequest, StockRequestStatus, Transaction } from "../api/types";
import { formatReturnPlan } from "../utils/requestDisplay";
import {
  DateRangePreset,
  TxTypeFilter,
  filterTransactionsByType,
  formatHistoryDate,
  formatTxQuantity,
  parsePipeRemark,
  resolveDateRange,
  sortRequestsByPriority,
} from "../utils/historyDisplay";
import { useAuth } from "../components/AuthGate";
import { Layout } from "../components/Layout";
import { PendingReturnsPanel } from "../components/PendingReturnsPanel";
import { ApprovalRecords } from "../components/ApprovalRecords";
import { EmptyState, SectionCard, TxBadge } from "../components/ui";

interface SearchSuggestion {
  label: string;
  value: string;
  hint: string;
}

type RequestView = StockRequestStatus | "ALL";
type StaffHistoryView = "transactions" | "returns" | "approvals";

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
  return "全部申请记录；已通过项也可在下方流水中查看";
}

function TransactionRow({
  tx,
  onOpenMaterial,
}: {
  tx: Transaction;
  onOpenMaterial: (materialId: string) => void;
}) {
  const parsed = parsePipeRemark(tx.remark);
  return (
    <div className="tx-item">
      <TxBadge type={tx.type} />
      <div className="tx-main">
        <button
          type="button"
          className="history-link-title tx-title"
          onClick={() => onOpenMaterial(tx.material_id)}
        >
          {tx.material_name ?? tx.material_id} · {tx.location_name ?? tx.location_id}
        </button>
        <div className="tx-meta">
          {tx.operator} · {formatHistoryDate(tx.created_at)}
        </div>
        {parsed.note && <div className="tx-meta">说明：{parsed.note}</div>}
        {parsed.slot && <div className="tx-meta">格位：{parsed.slot}</div>}
        {parsed.returnPlan && <div className="tx-meta">归还：{parsed.returnPlan}</div>}
        {parsed.approver && parsed.approver !== tx.operator && (
          <div className="tx-meta">审批人：{parsed.approver}</div>
        )}
      </div>
      <div className={`tx-qty ${tx.type === "出库" ? "tx-qty-out" : tx.type === "入库" ? "tx-qty-in" : ""}`}>
        {formatTxQuantity(tx.type, tx.quantity)}
      </div>
    </div>
  );
}

export default function HistoryPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { canApprove, canInbound } = useAuth();
  const staffHistoryOptions = useMemo(() => {
    const opts: Array<{ label: string; value: StaffHistoryView }> = [
      { label: "流水", value: "transactions" },
    ];
    if (canInbound) opts.push({ label: "待归还", value: "returns" });
    if (canApprove) opts.push({ label: "审批", value: "approvals" });
    return opts;
  }, [canInbound, canApprove]);
  const initialStaffView = searchParams.get("view") === "returns" ? "returns" : "transactions";
  const [staffView, setStaffView] = useState<StaffHistoryView>(initialStaffView);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [requests, setRequests] = useState<StockRequest[]>([]);
  const [keyword, setKeyword] = useState("");
  const [requestView, setRequestView] = useState<RequestView>("待审批");
  const [categories, setCategories] = useState<Category[]>([]);
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [operatorSuggestions, setOperatorSuggestions] = useState<SearchSuggestion[]>([]);
  const [operator, setOperator] = useState("");
  const [datePreset, setDatePreset] = useState<DateRangePreset>("all");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");
  const [txTypeFilter, setTxTypeFilter] = useState<TxTypeFilter>("ALL");
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!canInbound) return;
    const next = searchParams.get("view") === "returns" ? "returns" : "transactions";
    setStaffView(next);
  }, [canInbound, searchParams]);

  const setStaffHistoryView = (view: StaffHistoryView) => {
    setStaffView(view);
    if (view === "returns") {
      setSearchParams({ view: "returns" }, { replace: true });
    } else {
      setSearchParams({}, { replace: true });
    }
  };

  const showReturnsView = canInbound && staffView === "returns";
  const trimmedKeyword = keyword.trim();
  const displayedTxs = useMemo(() => filterTransactionsByType(txs, txTypeFilter), [txs, txTypeFilter]);

  const load = useCallback(async (nextKeyword = keyword) => {
    setLoading(true);
    try {
      const search = nextKeyword.trim() || undefined;
      const range = resolveDateRange(datePreset, customStartDate, customEndDate);
      const txPromise = listTransactions({
        keyword: search,
        operator: canApprove ? operator.trim() || undefined : undefined,
        startAt: range.startAt,
        endAt: range.endAt,
        limit: 300,
      });
      const reqPromise = canApprove
        ? Promise.resolve([])
        : listMyRequests({
            limit: 100,
            keyword: search,
            status: requestView === "ALL" ? undefined : requestView,
          });
      const [txData, reqData] = await Promise.all([txPromise, reqPromise]);
      setTxs(txData);
      setRequests(sortRequestsByPriority(reqData));
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "加载历史失败" });
    } finally {
      setLoading(false);
    }
  }, [canApprove, customEndDate, customStartDate, datePreset, keyword, operator, requestView]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!canApprove) return;
    void listApprovalRequests({ status: "待审批", limit: 200 })
      .then((items) => setPendingCount(items.length))
      .catch(() => setPendingCount(0));
  }, [canApprove, txs]);

  useEffect(() => {
    void listCategories()
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
    for (const tx of txs) {
      if (!tx.operator || tx.operator === "未知" || seen.has(tx.operator)) continue;
      seen.add(tx.operator);
      result.push({ label: tx.operator, value: tx.operator, hint: "流水操作人" });
    }
    for (const req of requests) {
      if (!req.requester_name || req.requester_name === "未知" || seen.has(req.requester_name)) continue;
      seen.add(req.requester_name);
      result.push({ label: req.requester_name, value: req.requester_name, hint: "申请人" });
    }
    return result;
  }, [requests, txs]);

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
    void load(suggestion.value);
  };

  const chooseOperatorSuggestion = (suggestion: SearchSuggestion) => {
    setOperator(suggestion.value);
    setOperatorSuggestions([]);
  };

  const openMaterial = (materialId: string) => {
    if (!materialId) return;
    navigate(`/materials/${materialId}`);
  };

  const txSectionTitle = loading
    ? "加载中…"
    : txTypeFilter === "ALL"
      ? `已执行流水 ${displayedTxs.length} 条`
      : `已执行流水 ${displayedTxs.length} 条（${txTypeFilter}，共 ${txs.length} 条）`;

  return (
    <Layout title="历史">
      {canApprove && pendingCount > 0 && (
        <div className="history-pending-banner">
          <span>待审批 {pendingCount} 条出入库申请</span>
          <Button size="small" color="primary" fill="outline" onClick={() => navigate("/admin-center")}>
            去审批
          </Button>
        </div>
      )}

      {canInbound && (
        <SectionCard title="历史视图" subtitle="流水追溯、待归还监管与审批记录">
          <Selector
            className="history-request-tabs"
            options={staffHistoryOptions}
            value={[staffView]}
            onChange={(arr) =>
              setStaffHistoryView((arr[0] as StaffHistoryView | undefined) ?? "transactions")
            }
          />
        </SectionCard>
      )}

      {staffView === "approvals" ? (
        <ApprovalRecords />
      ) : showReturnsView ? (
        <PendingReturnsPanel showBorrowerFilter />
      ) : (
        <>
      <SectionCard
        title={canApprove ? "全部出入库历史" : "我的出入库历史"}
        subtitle={
          canApprove
            ? "快捷筛选时间/类型；更多条件可展开"
            : "搜索同时作用于申请与流水；默认查看进行中的申请"
        }
      >
        <SearchBar
          placeholder="搜索物品 / 库位 / 备注"
          value={keyword}
          onChange={setKeyword}
          onSearch={() => void load()}
          onClear={() => {
            setKeyword("");
            setSuggestions([]);
            void load("");
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

        {canApprove && (
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
            <Form.Item label="流水类型">
              <Selector
                options={TX_TYPE_OPTIONS}
                value={[txTypeFilter]}
                onChange={(arr) => setTxTypeFilter((arr[0] as TxTypeFilter | undefined) ?? "ALL")}
              />
            </Form.Item>
            <button
              type="button"
              className="history-filter-toggle"
              onClick={() => setFiltersExpanded((v) => !v)}
            >
              {filtersExpanded ? "收起成员筛选 ▲" : "按成员筛选 ▼"}
            </button>
            {filtersExpanded && (
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
            )}
          </div>
        )}

        <Button block color="primary" loading={loading} onClick={() => void load()}>
          查询
        </Button>
        {canApprove && (datePreset !== "all" || operator.trim() || trimmedKeyword) && (
          <div className="history-active-filters">
            {datePreset !== "all" && (
              <span className="history-filter-tag">
                时间：
                {datePreset === "7d"
                  ? "近7天"
                  : datePreset === "30d"
                    ? "近30天"
                    : `${customStartDate || "…"} ~ ${customEndDate || "…"}`}
              </span>
            )}
            {operator.trim() && <span className="history-filter-tag">成员：{operator.trim()}</span>}
            {trimmedKeyword && <span className="history-filter-tag">关键词：{trimmedKeyword}</span>}
          </div>
        )}
      </SectionCard>

      {!canApprove && (
        <SectionCard title={`我的申请 ${requests.length} 条`} subtitle={requestViewHint(requestView)}>
          <Selector
            className="history-request-tabs"
            options={REQUEST_VIEW_OPTIONS}
            value={[requestView]}
            onChange={(arr) => setRequestView((arr[0] as RequestView | undefined) ?? "待审批")}
          />
          {requests.length === 0 ? (
            <EmptyState
              icon="📋"
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
      )}

      <SectionCard title={txSectionTitle}>
        {displayedTxs.length === 0 ? (
          <EmptyState
            icon="📒"
            text={
              trimmedKeyword
                ? `未找到与「${trimmedKeyword}」相关的流水`
                : txTypeFilter !== "ALL"
                  ? `暂无${txTypeFilter}流水`
                  : "暂无流水"
            }
            hint={
              trimmedKeyword || txTypeFilter !== "ALL"
                ? "试试清空搜索或更换筛选"
                : "审批通过或库管直接操作后会显示"
            }
          />
        ) : (
          displayedTxs.map((tx) => (
            <TransactionRow key={tx.id} tx={tx} onOpenMaterial={openMaterial} />
          ))
        )}
      </SectionCard>
        </>
      )}
    </Layout>
  );
}
