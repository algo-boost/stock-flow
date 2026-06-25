import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NavigateFunction } from "react-router-dom";
import {
  detailContextAfterStock,
  navigateAfterStockSubmit,
  openMaterialDetail,
  openStockForMaterial,
  openStockPage,
  readDetailNavState,
  readShelfNavState,
  readStockNavState,
  resolveDetailBack,
  resolveShelfBack,
} from "./detailNavigation";

describe("detailNavigation", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

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

  it("readStockNavState 无物料时使用 stock:page", () => {
    openStockPage(vi.fn() as unknown as NavigateFunction, "inbound", {
      materialBackTo: "/shelves/loc_01",
    });
    expect(readStockNavState(undefined).materialBackTo).toBe("/shelves/loc_01");
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
    expect(navigate).toHaveBeenLastCalledWith(
      "/stock?tab=outbound&material_id=mat_001",
      expect.objectContaining({ state: expect.objectContaining({ materialBackTo: "/materials/mat_001" }) }),
    );
  });

  it("openStockForMaterial 支持自定义 materialBackTo", () => {
    const navigate = vi.fn() as unknown as NavigateFunction;
    openStockForMaterial(navigate, "mat_001", "inbound", { backTo: "/", backState: { browseBy: "category" } }, {
      materialBackTo: "/",
    });
    expect(navigate).toHaveBeenCalledWith(
      "/stock?tab=inbound&material_id=mat_001",
      expect.objectContaining({
        state: expect.objectContaining({
          materialBackTo: "/",
          detailBackTo: "/",
          detailBackState: { browseBy: "category" },
        }),
      }),
    );
  });

  it("openStockPage 支持额外 query 参数", () => {
    const navigate = vi.fn() as unknown as NavigateFunction;
    openStockPage(navigate, "inbound", {
      materialId: "mat_001",
      materialBackTo: "/history?view=returns",
      searchParams: { location_id: "loc_01", qty: 2, return_note: "归还" },
    });
    expect(navigate).toHaveBeenCalledWith(
      "/stock?tab=inbound&material_id=mat_001&location_id=loc_01&qty=2&return_note=%E5%BD%92%E8%BF%98",
      expect.any(Object),
    );
  });

  it("navigateAfterStockSubmit 非详情路径直接返回来源页", () => {
    const navigate = vi.fn() as unknown as NavigateFunction;
    navigateAfterStockSubmit(navigate, "mat_001", {
      materialBackTo: "/history?view=returns",
    });
    expect(navigate).toHaveBeenCalledWith("/history?view=returns", undefined);
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

  it("刷新后从 sessionStorage 恢复详情导航", () => {
    openMaterialDetail(vi.fn() as unknown as NavigateFunction, "mat_001", {
      backTo: "/",
      fromLabel: "首页",
    });
    const restored = readDetailNavState(undefined, "mat_001");
    expect(restored.backTo).toBe("/");
    expect(restored.fromLabel).toBe("首页");
  });

  it("刷新后从 sessionStorage 恢复出入库导航", () => {
    const navigate = vi.fn() as unknown as NavigateFunction;
    openStockForMaterial(navigate, "mat_001", "inbound", { backTo: "/history" });
    const restored = readStockNavState(undefined, "mat_001");
    expect(restored.materialBackTo).toBe("/materials/mat_001");
    expect(restored.detailBackTo).toBe("/history");
  });
});
