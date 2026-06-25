import type { DateRangePreset, TxTypeFilter } from "./historyDisplay";
import { resolveDateRange } from "./historyDisplay";

export interface TransactionQueryState {
  keyword: string;
  txType: TxTypeFilter;
  operator: string;
  locationId: string;
  datePreset: DateRangePreset;
  customStartDate: string;
  customEndDate: string;
  page: number;
}

export const TX_PAGE_SIZE = 20;

export function parseTransactionQuery(searchParams: URLSearchParams): TransactionQueryState {
  const txTypeRaw = searchParams.get("type");
  const txType: TxTypeFilter =
    txTypeRaw === "入库" || txTypeRaw === "出库" || txTypeRaw === "移动" ? txTypeRaw : "ALL";
  const dateRaw = searchParams.get("date");
  const datePreset: DateRangePreset =
    dateRaw === "7d" || dateRaw === "30d" || dateRaw === "custom" ? dateRaw : "all";
  const pageRaw = Number(searchParams.get("page") ?? "1");
  return {
    keyword: searchParams.get("q") ?? "",
    txType,
    operator: searchParams.get("operator") ?? "",
    locationId: searchParams.get("location") ?? "",
    datePreset,
    customStartDate: searchParams.get("start") ?? "",
    customEndDate: searchParams.get("end") ?? "",
    page: Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1,
  };
}

export function buildTransactionQueryParams(state: TransactionQueryState): URLSearchParams {
  const params = new URLSearchParams();
  const keyword = state.keyword.trim();
  if (keyword) params.set("q", keyword);
  if (state.txType !== "ALL") params.set("type", state.txType);
  const operator = state.operator.trim();
  if (operator) params.set("operator", operator);
  if (state.locationId) params.set("location", state.locationId);
  if (state.datePreset !== "all") {
    params.set("date", state.datePreset);
    if (state.datePreset === "custom") {
      if (state.customStartDate) params.set("start", state.customStartDate);
      if (state.customEndDate) params.set("end", state.customEndDate);
    }
  }
  if (state.page > 1) params.set("page", String(state.page));
  return params;
}

export function transactionQueryToApiArgs(state: TransactionQueryState) {
  const range = resolveDateRange(state.datePreset, state.customStartDate, state.customEndDate);
  return {
    keyword: state.keyword.trim() || undefined,
    operator: state.operator.trim() || undefined,
    locationId: state.locationId || undefined,
    txType: state.txType !== "ALL" ? state.txType : undefined,
    startAt: range.startAt,
    endAt: range.endAt,
    page: state.page,
    size: TX_PAGE_SIZE,
  };
}

export function transactionQuerySummary(state: TransactionQueryState): string {
  const parts: string[] = [];
  if (state.keyword.trim()) parts.push(`关键词「${state.keyword.trim()}」`);
  if (state.txType !== "ALL") parts.push(state.txType);
  if (state.operator.trim()) parts.push(`操作人 ${state.operator.trim()}`);
  if (state.datePreset === "7d") parts.push("近7天");
  if (state.datePreset === "30d") parts.push("近30天");
  if (state.datePreset === "custom") {
    parts.push(`${state.customStartDate || "…"} ~ ${state.customEndDate || "…"}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "全部流水";
}
