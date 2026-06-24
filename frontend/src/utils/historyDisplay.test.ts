import { describe, expect, it } from "vitest";
import {
  cleanSystemRemarkLabels,
  filterTransactions,
  formatHistoryDate,
  formatTxQuantity,
  parsePipeRemark,
  resolveDateRange,
  sortRequestsByPriority,
} from "./historyDisplay";

describe("historyDisplay", () => {
  it("parsePipeRemark 解析格位与归还", () => {
    const parsed = parsePipeRemark("实验领用 | 格位:1:6 | 需归还：2026-07-01；审批人: 管理员");
    expect(parsed.note).toBe("实验领用");
    expect(parsed.slot).toBe("1 行 6 列");
    expect(parsed.returnPlan).toContain("2026-07-01");
    expect(parsed.approver).toBe("管理员");
  });

  it("cleanSystemRemarkLabels 去掉系统标签", () => {
    expect(cleanSystemRemarkLabels("备注；申请人: 张三；操作人: 李四")).toBe("备注");
  });

  it("formatTxQuantity 区分出入库符号", () => {
    expect(formatTxQuantity("入库", 3)).toBe("+3");
    expect(formatTxQuantity("出库", -2)).toBe("-2");
  });

  it("filterTransactions 组合筛选", () => {
    const items = [
      { type: "入库", operator: "库管员", location_id: "loc_01" },
      { type: "出库", operator: "研发", location_id: "loc_02" },
    ];
    const filtered = filterTransactions(items, "入库", "库管", "loc_01");
    expect(filtered).toHaveLength(1);
    expect(filtered[0].type).toBe("入库");
  });

  it("resolveDateRange 生成 7 天区间", () => {
    const range = resolveDateRange("7d", "", "");
    expect(range.startAt).toMatch(/T00:00:00$/);
    expect(range.endAt).toMatch(/T23:59:59$/);
  });

  it("sortRequestsByPriority 待审批置顶", () => {
    const sorted = sortRequestsByPriority([
      { status: "已通过", created_at: "2026-06-02T10:00:00Z" },
      { status: "待审批", created_at: "2026-06-01T10:00:00Z" },
    ]);
    expect(sorted[0].status).toBe("待审批");
  });

  it("formatHistoryDate 格式化 ISO 时间", () => {
    expect(formatHistoryDate("2026-06-15T08:05:00Z")).toMatch(/^2026-06-15 \d{2}:\d{2}$/);
  });
});
