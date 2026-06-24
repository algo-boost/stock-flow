import type { NavigateFunction } from "react-router-dom";

export interface ShelfNavState {
  backTo?: string;
  backState?: unknown;
}

export function readShelfNavState(state: unknown): ShelfNavState {
  if (!state || typeof state !== "object") return {};
  const raw = state as ShelfNavState;
  return {
    backTo: typeof raw.backTo === "string" ? raw.backTo : undefined,
    backState: raw.backState,
  };
}

export function resolveShelfBack(
  navigate: NavigateFunction,
  shelfNav: ShelfNavState,
  fallback: () => void,
) {
  if (shelfNav.backTo) {
    navigate(shelfNav.backTo, shelfNav.backState ? { state: shelfNav.backState } : undefined);
    return;
  }
  fallback();
}

export interface DetailNavState {
  backTo?: string;
  backState?: unknown;
  fromLabel?: string;
}

export interface StockNavState {
  materialBackTo: string;
  detailBackTo?: string;
  detailBackState?: unknown;
  fromLabel?: string;
}

export function readDetailNavState(state: unknown): DetailNavState {
  if (!state || typeof state !== "object") return {};
  const raw = state as DetailNavState;
  return {
    backTo: typeof raw.backTo === "string" ? raw.backTo : undefined,
    backState: raw.backState,
    fromLabel: typeof raw.fromLabel === "string" ? raw.fromLabel : undefined,
  };
}

export function readStockNavState(state: unknown): StockNavState {
  if (!state || typeof state !== "object") return { materialBackTo: "/" };
  const raw = state as StockNavState;
  return {
    materialBackTo: typeof raw.materialBackTo === "string" ? raw.materialBackTo : "/",
    detailBackTo: typeof raw.detailBackTo === "string" ? raw.detailBackTo : undefined,
    detailBackState: raw.detailBackState,
    fromLabel: typeof raw.fromLabel === "string" ? raw.fromLabel : undefined,
  };
}

export function detailContextAfterStock(stockState: StockNavState): DetailNavState {
  return {
    backTo: stockState.detailBackTo,
    backState: stockState.detailBackState,
    fromLabel: stockState.fromLabel,
  };
}

export function openMaterialDetail(
  navigate: NavigateFunction,
  materialId: string,
  ctx?: DetailNavState,
) {
  navigate(`/materials/${materialId}`, { state: ctx });
}

export function openStockForMaterial(
  navigate: NavigateFunction,
  materialId: string,
  tab: "outbound" | "inbound" | "transfer",
  detailCtx: DetailNavState,
) {
  const params = new URLSearchParams({ material_id: materialId, tab });
  const state: StockNavState = {
    materialBackTo: `/materials/${materialId}`,
    detailBackTo: detailCtx.backTo,
    detailBackState: detailCtx.backState,
    fromLabel: detailCtx.fromLabel,
  };
  navigate(`/stock?${params.toString()}`, { state });
}

export function resolveDetailBack(
  navigate: NavigateFunction,
  navState: DetailNavState,
) {
  if (navState.backTo) {
    navigate(navState.backTo, navState.backState ? { state: navState.backState } : undefined);
    return;
  }
  if (window.history.length > 1) {
    navigate(-1);
    return;
  }
  navigate("/");
}
