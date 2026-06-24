import { describe, expect, it, vi } from "vitest";
import type { NavigateFunction } from "react-router-dom";
import {
  detailContextAfterStock,
  openMaterialDetail,
  openStockForMaterial,
  readDetailNavState,
  readShelfNavState,
  readStockNavState,
  resolveDetailBack,
  resolveShelfBack,
} from "./detailNavigation";

describe("detailNavigation", () => {
  it("readDetailNavState 解析有效 state", () => {
    const state = readDetailNavState({
      backTo: "/shelves/loc_01",
      fromLabel: "A柜 · 1层2格",
    });
    expect(state.backTo).toBe("/shelves/loc_01");
    expect(state.fromLabel).toBe("A柜 · 1层2格");
  });

  it("readShelfNavState 空值安全", () => {
    expect(readShelfNavState(null)).toEqual({});
    expect(readShelfNavState({ backTo: "/materials/m1" }).backTo).toBe("/materials/m1");
  });

  it("readStockNavState 默认回首页", () => {
    expect(readStockNavState(undefined).materialBackTo).toBe("/");
  });

  it("detailContextAfterStock 保留详情上下文", () => {
    const ctx = detailContextAfterStock({
      materialBackTo: "/materials/m1",
      detailBackTo: "/",
      fromLabel: "首页",
    });
    expect(ctx.backTo).toBe("/");
    expect(ctx.fromLabel).toBe("首页");
  });

  it("openMaterialDetail / openStockForMaterial 调用 navigate", () => {
    const navigate = vi.fn() as unknown as NavigateFunction;
    openMaterialDetail(navigate, "mat_001", { backTo: "/" });
    expect(navigate).toHaveBeenCalledWith("/materials/mat_001", { state: { backTo: "/" } });

    openStockForMaterial(navigate, "mat_001", "outbound", { backTo: "/" });
    expect(navigate).toHaveBeenCalledWith(
      "/stock?material_id=mat_001&tab=outbound",
      expect.objectContaining({ state: expect.objectContaining({ materialBackTo: "/materials/mat_001" }) }),
    );
  });

  it("resolveDetailBack 优先 backTo", () => {
    const navigate = vi.fn() as unknown as NavigateFunction;
    resolveDetailBack(navigate, { backTo: "/history", backState: { q: "电机" } });
    expect(navigate).toHaveBeenCalledWith("/history", { state: { q: "电机" } });
  });

  it("resolveShelfBack 无 backTo 时走 fallback", () => {
    const navigate = vi.fn() as unknown as NavigateFunction;
    const fallback = vi.fn();
    resolveShelfBack(navigate, {}, fallback);
    expect(fallback).toHaveBeenCalled();
  });
});
