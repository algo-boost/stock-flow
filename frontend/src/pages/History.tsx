import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Form, Input, SearchBar, Toast } from "antd-mobile";
import { listCategories, listMyRequests, listTransactions, searchMaterials } from "../api";
import type { Category, StockRequest, Transaction } from "../api/types";
import { useAuth } from "../components/AuthGate";
import { Layout } from "../components/Layout";
import { EmptyState, SectionCard, TxBadge } from "../components/ui";

interface SearchSuggestion {
  label: string;
  value: string;
  hint: string;
}

function pad2(value: string) {
  return value.trim().padStart(2, "0");
}

function buildDate(year: string, month: string, day: string) {
  const y = year.trim();
  const m = month.trim();
  const d = day.trim();
  if (!y && !m && !d) return "";
  if (!/^\d{4}$/.test(y) || !/^\d{1,2}$/.test(m) || !/^\d{1,2}$/.test(d)) return "";
  const mm = pad2(m);
  const dd = pad2(d);
  const date = new Date(`${y}-${mm}-${dd}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  if (
    date.getFullYear() !== Number(y) ||
    date.getMonth() + 1 !== Number(mm) ||
    date.getDate() !== Number(dd)
  ) {
    return "";
  }
  return `${y}-${mm}-${dd}`;
}

function splitDate(value: string) {
  const [year = "", month = "", day = ""] = value.split("-");
  return { year, month, day };
}

export default function HistoryPage() {
  const { canApprove } = useAuth();
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [requests, setRequests] = useState<StockRequest[]>([]);
  const [keyword, setKeyword] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [operatorSuggestions, setOperatorSuggestions] = useState<SearchSuggestion[]>([]);
  const [operator, setOperator] = useState("");
  const [startYear, setStartYear] = useState("");
  const [startMonth, setStartMonth] = useState("");
  const [startDay, setStartDay] = useState("");
  const [endYear, setEndYear] = useState("");
  const [endMonth, setEndMonth] = useState("");
  const [endDay, setEndDay] = useState("");
  const [loading, setLoading] = useState(false);

  const startDate = buildDate(startYear, startMonth, startDay);
  const endDate = buildDate(endYear, endMonth, endDay);

  const load = useCallback(async (nextKeyword = keyword) => {
    setLoading(true);
    try {
      const txPromise = listTransactions({
        keyword: nextKeyword.trim() || undefined,
        operator: canApprove ? operator.trim() || undefined : undefined,
        startAt: startDate ? `${startDate}T00:00:00` : undefined,
        endAt: endDate ? `${endDate}T23:59:59` : undefined,
        limit: 300,
      });
      const reqPromise = canApprove ? Promise.resolve([]) : listMyRequests({ limit: 100 });
      const [txData, reqData] = await Promise.all([txPromise, reqPromise]);
      setTxs(txData);
      setRequests(reqData);
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "加载历史失败" });
    } finally {
      setLoading(false);
    }
  }, [canApprove, endDate, keyword, operator, startDate]);

  useEffect(() => {
    void load();
  }, [load]);

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
    const text = keyword.trim().toLowerCase();
    if (!text) {
      setSuggestions([]);
      return;
    }

    const timer = window.setTimeout(() => {
      const categoryMatches = categorySuggestionPool
        .filter((item) => item.label.toLowerCase().includes(text) || item.value.toLowerCase().includes(text))
        .slice(0, 5);

      void searchMaterials(keyword.trim(), { page: 1, size: 5, searchBy: "all" })
        .then((data) => {
          const seen = new Set(categoryMatches.map((item) => item.value));
          const next: SearchSuggestion[] = [...categoryMatches];
          for (const item of data.items) {
            if (!item.name || seen.has(item.name)) continue;
            seen.add(item.name);
            next.push({
              label: item.name,
              value: item.name,
              hint:
                item.major_category && item.sub_category
                  ? `${item.major_category} / ${item.sub_category}`
                  : item.category_name ?? item.code,
            });
            if (next.length >= 5) break;
          }
          setSuggestions(next.slice(0, 5));
        })
        .catch(() => setSuggestions(categoryMatches));
    }, 220);

    return () => window.clearTimeout(timer);
  }, [categorySuggestionPool, keyword]);

  const chooseSuggestion = (suggestion: SearchSuggestion) => {
    setKeyword(suggestion.value);
    setSuggestions([]);
    void load(suggestion.value);
  };

  const memberSuggestionPool = useMemo(() => {
    const seen = new Set<string>();
    const result: SearchSuggestion[] = [];
    for (const tx of txs) {
      if (!tx.operator || seen.has(tx.operator)) continue;
      seen.add(tx.operator);
      result.push({ label: tx.operator, value: tx.operator, hint: "流水操作人" });
    }
    for (const req of requests) {
      if (!req.requester_name || seen.has(req.requester_name)) continue;
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
      setOperatorSuggestions(memberSuggestionPool.slice(0, 5));
      return;
    }
    setOperatorSuggestions(
      memberSuggestionPool
        .filter((item) => item.label.toLowerCase().includes(text) || item.value.toLowerCase().includes(text))
        .slice(0, 5),
    );
  }, [canApprove, memberSuggestionPool, operator]);

  const chooseOperatorSuggestion = (suggestion: SearchSuggestion) => {
    setOperator(suggestion.value);
    setOperatorSuggestions([]);
  };

  const applyStartDate = (date: string) => {
    const parts = splitDate(date);
    setStartYear(parts.year);
    setStartMonth(parts.month);
    setStartDay(parts.day);
  };

  const applyEndDate = (date: string) => {
    const parts = splitDate(date);
    setEndYear(parts.year);
    setEndMonth(parts.month);
    setEndDay(parts.day);
  };

  return (
    <Layout title="历史">
      <SectionCard
        title={canApprove ? "全部出入库历史" : "我的出入库历史"}
        subtitle={canApprove ? "可按时间、成员、物品/库位/备注筛选" : "包含我的申请状态和审批通过后的流水"}
      >
        <SearchBar
          placeholder="搜索物品 / 库位 / 备注"
          value={keyword}
          onChange={setKeyword}
          onSearch={() => void load()}
          onClear={() => {
            setKeyword("");
            setSuggestions([]);
            void load();
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
          <Form layout="vertical" className="form-card history-filters">
            <Form.Item label="成员">
              <Input
                value={operator}
                onChange={setOperator}
                onFocus={() => setOperatorSuggestions(memberSuggestionPool.slice(0, 5))}
                placeholder="输入成员姓名"
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
            <Form.Item label="开始时间">
              <div className="date-filter-row">
                <Input value={startYear} onChange={setStartYear} placeholder="年" />
                <Input value={startMonth} onChange={setStartMonth} placeholder="月" />
                <Input value={startDay} onChange={setStartDay} placeholder="日" />
              </div>
              <input
                className="native-date-input"
                type="date"
                value={startDate}
                onChange={(e) => applyStartDate(e.target.value)}
              />
            </Form.Item>
            <Form.Item label="结束时间">
              <div className="date-filter-row">
                <Input value={endYear} onChange={setEndYear} placeholder="年" />
                <Input value={endMonth} onChange={setEndMonth} placeholder="月" />
                <Input value={endDay} onChange={setEndDay} placeholder="日" />
              </div>
              <input
                className="native-date-input"
                type="date"
                value={endDate}
                onChange={(e) => applyEndDate(e.target.value)}
              />
            </Form.Item>
          </Form>
        )}
        <Button block color="primary" loading={loading} onClick={() => void load()}>
          查询
        </Button>
      </SectionCard>

      {!canApprove && (
        <SectionCard title={`我的申请 ${requests.length} 条`}>
          {requests.length === 0 ? (
            <EmptyState icon="📋" text="暂无申请记录" />
          ) : (
            requests.map((item) => (
              <div className="request-item" key={item.id}>
                <div className="request-item-header">
                  <TxBadge type={item.type} />
                  <span className={`request-status request-status-${item.status}`}>{item.status}</span>
                </div>
                <div className="request-title">
                  {item.material_name ?? item.material_id} × {item.quantity}
                </div>
                <div className="tx-meta">
                  {item.location_name ?? item.location_id} · {new Date(item.created_at).toLocaleString()}
                </div>
                {item.approver_name && <div className="tx-meta">审批人：{item.approver_name}</div>}
                {item.reject_reason && <div className="tx-meta">拒绝原因：{item.reject_reason}</div>}
              </div>
            ))
          )}
        </SectionCard>
      )}

      <SectionCard title={loading ? "加载中…" : `已执行流水 ${txs.length} 条`}>
        {txs.length === 0 ? (
          <EmptyState icon="📒" text="暂无流水" hint="审批通过或库管直接操作后会显示" />
        ) : (
          txs.map((tx) => (
            <div className="tx-item" key={tx.id}>
              <TxBadge type={tx.type} />
              <div className="tx-main">
                <div className="tx-title">
                  {tx.material_name ?? tx.material_id} · {tx.location_name ?? tx.location_id}
                </div>
                <div className="tx-meta">
                  {tx.operator} · {new Date(tx.created_at).toLocaleString()}
                  {tx.remark ? ` · ${tx.remark}` : ""}
                </div>
              </div>
              <div className="tx-qty">
                {tx.quantity > 0 ? "+" : ""}
                {tx.quantity}
              </div>
            </div>
          ))
        )}
      </SectionCard>
    </Layout>
  );
}
