import type { StockRequest } from "../api/types";

export function formatReturnPlan(item: Pick<StockRequest, "type" | "return_required" | "return_due_at">) {
  if (item.type !== "出库" || item.return_required == null) return null;
  if (item.return_required) {
    return item.return_due_at ? `需归还 · 预计 ${item.return_due_at}` : "需归还";
  }
  return "无须归还";
}
