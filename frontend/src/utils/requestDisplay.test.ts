import { describe, expect, it } from "vitest";
import { formatReturnPlan } from "./requestDisplay";

describe("requestDisplay", () => {
  it("formatReturnPlan 出库需归还", () => {
    expect(
      formatReturnPlan({
        type: "出库",
        return_required: true,
        return_due_at: "2026-07-01",
      }),
    ).toBe("需归还 · 预计 2026-07-01");
  });

  it("formatReturnPlan 入库返回 null", () => {
    expect(formatReturnPlan({ type: "入库", return_required: true })).toBeNull();
  });

  it("formatReturnPlan 无须归还", () => {
    expect(formatReturnPlan({ type: "出库", return_required: false })).toBe("无须归还");
  });
});
