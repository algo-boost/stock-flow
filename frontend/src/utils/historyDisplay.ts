const SYSTEM_LABEL_VALUE = "[^；|]+";
const SYSTEM_REMARK_LABEL = new RegExp(`(?:^|；)\\s*(?:申请人|审批人|操作人)\\s*[:：]\\s*${SYSTEM_LABEL_VALUE}`, "g");
const SYSTEM_LABEL_TAIL = new RegExp(`(?:；|^)\\s*(?:审批人|操作人|申请人)\\s*[:：]\\s*${SYSTEM_LABEL_VALUE}$`);
const INLINE_SYSTEM_LABEL = new RegExp(`(?:；|^)\\s*(?:审批人|操作人|申请人)\\s*[:：]\\s*${SYSTEM_LABEL_VALUE}`);

function stripSystemLabelsForParse(remark: string): string {
  let text = remark.trim();
  while (true) {
    const next = text.replace(SYSTEM_LABEL_TAIL, "").trim();
    if (next === text) return text;
    text = next;
  }
}
const SLOT_SUFFIX = /\s*\|\s*格位:(\d+):(\d+)\s*$/;
const RETURN_NOT_REQUIRED = /\s*\|\s*无须归还\s*$/;
const RETURN_REQUIRED = /\s*\|\s*需归还：(\d{4}-\d{2}-\d{2})\s*$/;
const RETURN_REQUIRED_NO_DATE = /\s*\|\s*需归还\s*$/;

export type DateRangePreset = "all" | "7d" | "30d" | "custom";
export type TxTypeFilter = "ALL" | "入库" | "出库" | "移动";

export interface ParsedPipeRemark {
  note: string;
  slot: string | null;
  returnPlan: string | null;
  approver: string | null;
}

/** 去掉备注中的系统标签，只保留用户填写内容 */
export function cleanSystemRemarkLabels(remark: string | null | undefined): string {
  if (!remark) return "";
  return remark
    .replace(SYSTEM_REMARK_LABEL, "")
    .replace(/^；+|；+$/g, "")
    .replace(/；+/g, "；")
    .trim();
}

export function extractRemarkLabel(remark: string | null | undefined, prefix: string): string | null {
  if (!remark) return null;
  const match = remark.match(new RegExp(`(?:^|；)\\s*${prefix}:\\s*([^；]+)`));
  return match?.[1]?.trim() ?? null;
}

/** 解析流水/申请备注中的格位、归还计划与用户说明 */
export function parsePipeRemark(remark: string | null | undefined): ParsedPipeRemark {
  const approver = extractRemarkLabel(remark, "审批人");
  let text = stripSystemLabelsForParse(remark || "");
  let row: number | null = null;
  let column: number | null = null;
  let returnPlan: string | null = null;

  while (text) {
    let changed = false;
    const slotMatch = SLOT_SUFFIX.exec(text);
    if (slotMatch && slotMatch.index + slotMatch[0].length === text.length) {
      row = Number(slotMatch[1]);
      column = Number(slotMatch[2]);
      text = text.slice(0, slotMatch.index).trim();
      changed = true;
      continue;
    }
    const noReturn = RETURN_NOT_REQUIRED.exec(text);
    if (noReturn && noReturn.index + noReturn[0].length === text.length) {
      returnPlan = "无须归还";
      text = text.slice(0, noReturn.index).trim();
      changed = true;
      continue;
    }
    const dueMatch = RETURN_REQUIRED.exec(text);
    if (dueMatch && dueMatch.index + dueMatch[0].length === text.length) {
      returnPlan = `需归还 · 预计 ${dueMatch[1]}`;
      text = text.slice(0, dueMatch.index).trim();
      changed = true;
      continue;
    }
    const noDate = RETURN_REQUIRED_NO_DATE.exec(text);
    if (noDate && noDate.index + noDate[0].length === text.length) {
      returnPlan = "需归还";
      text = text.slice(0, noDate.index).trim();
      changed = true;
      continue;
    }
    if (!changed) break;
  }

  const note = cleanSystemRemarkLabels(text.replace(INLINE_SYSTEM_LABEL, "").replace(/^；+|；+$/g, "").trim());
  const slot = row != null && column != null ? `${row} 行 ${column} 列` : null;
  return { note, slot, returnPlan, approver };
}

export function formatHistoryDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatIsoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function resolveDateRange(
  preset: DateRangePreset,
  customStart: string,
  customEnd: string,
): { startAt?: string; endAt?: string } {
  if (preset === "7d" || preset === "30d") {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - (preset === "7d" ? 7 : 30));
    return {
      startAt: `${formatIsoDate(start)}T00:00:00`,
      endAt: `${formatIsoDate(end)}T23:59:59`,
    };
  }
  if (preset === "custom" || customStart || customEnd) {
    return {
      startAt: customStart ? `${customStart}T00:00:00` : undefined,
      endAt: customEnd ? `${customEnd}T23:59:59` : undefined,
    };
  }
  return {};
}

const REQUEST_STATUS_RANK: Record<string, number> = {
  待审批: 0,
  已拒绝: 1,
  已通过: 2,
};

/** 待审批置顶，其余按时间倒序 */
export function sortRequestsByPriority<T extends { status: string; created_at: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const rankDiff = (REQUEST_STATUS_RANK[a.status] ?? 9) - (REQUEST_STATUS_RANK[b.status] ?? 9);
    if (rankDiff !== 0) return rankDiff;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

export function formatTxQuantity(type: string, quantity: number): string {
  const abs = Math.abs(quantity);
  if (type === "出库") return `-${abs}`;
  if (type === "入库") return `+${abs}`;
  return `${quantity > 0 ? "+" : ""}${quantity}`;
}

export function filterTransactionsByType<T extends { type: string }>(items: T[], filter: TxTypeFilter): T[] {
  if (filter === "ALL") return items;
  return items.filter((item) => item.type === filter);
}

export function filterTransactions<T extends { type: string; operator: string; location_id: string }>(
  items: T[],
  typeFilter: TxTypeFilter,
  operatorFilter: string,
  locationIdFilter: string,
): T[] {
  let result = filterTransactionsByType(items, typeFilter);
  const operator = operatorFilter.trim();
  if (operator) {
    result = result.filter((item) => item.operator.includes(operator));
  }
  if (locationIdFilter) {
    result = result.filter((item) => item.location_id === locationIdFilter);
  }
  return result;
}
