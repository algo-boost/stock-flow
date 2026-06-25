import type { NavigateFunction } from "react-router-dom";

const NAV_PREFIX = "stock-flow:nav:";

function saveNav(key: string, value: unknown) {
  try {
    sessionStorage.setItem(`${NAV_PREFIX}${key}`, JSON.stringify(value));
  } catch {
    /* ignore quota / private mode */
  }
}

function loadNav<T extends object>(key: string): Partial<T> {
  try {
    const raw = sessionStorage.getItem(`${NAV_PREFIX}${key}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<T>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function mergeNav<T extends object>(routeState: Partial<T>, storageKey: string, defaults?: Partial<T>): T {
  const stored = loadNav<T>(storageKey);
  const merged = { ...defaults, ...stored, ...routeState } as T;
  const hasRouteData = Object.keys(routeState).length > 0;
  const hasStoredData = Object.keys(stored).length > 0;
  if (hasRouteData || hasStoredData || defaults) {
    saveNav(storageKey, merged);
  }
  return merged;
}

export interface ShelfNavState {
  backTo?: string;
  backState?: unknown;
}

export function readShelfNavState(state: unknown, locationId?: string): ShelfNavState {
  const fromRoute: Partial<ShelfNavState> = {};
  if (state && typeof state === "object") {
    const raw = state as ShelfNavState;
    if (typeof raw.backTo === "string") fromRoute.backTo = raw.backTo;
    if (raw.backState !== undefined) fromRoute.backState = raw.backState;
  }
  if (!locationId) return fromRoute;
  return mergeNav(fromRoute, `shelf:${locationId}`);
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

export interface OpenStockOptions {
  materialBackTo?: string;
  searchParams?: Record<string, string | number | undefined | null>;
}

export function readDetailNavState(state: unknown, materialId?: string): DetailNavState {
  const fromRoute: Partial<DetailNavState> = {};
  if (state && typeof state === "object") {
    const raw = state as DetailNavState;
    if (typeof raw.backTo === "string") fromRoute.backTo = raw.backTo;
    if (raw.backState !== undefined) fromRoute.backState = raw.backState;
    if (typeof raw.fromLabel === "string") fromRoute.fromLabel = raw.fromLabel;
  }
  if (!materialId) return fromRoute;
  return mergeNav(fromRoute, `detail:${materialId}`);
}

export function readStockNavState(state: unknown, materialId?: string): StockNavState {
  const fromRoute: Partial<StockNavState> = {};
  if (state && typeof state === "object") {
    const raw = state as StockNavState;
    if (typeof raw.materialBackTo === "string") fromRoute.materialBackTo = raw.materialBackTo;
    if (typeof raw.detailBackTo === "string") fromRoute.detailBackTo = raw.detailBackTo;
    if (raw.detailBackState !== undefined) fromRoute.detailBackState = raw.detailBackState;
    if (typeof raw.fromLabel === "string") fromRoute.fromLabel = raw.fromLabel;
  }
  const storageKey = materialId ? `stock:${materialId}` : "stock:page";
  const defaults: Partial<StockNavState> = materialId
    ? { materialBackTo: `/materials/${materialId}` }
    : { materialBackTo: "/" };
  return mergeNav(fromRoute, storageKey, defaults);
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
  const state = ctx ?? {};
  saveNav(`detail:${materialId}`, state);
  navigate(`/materials/${materialId}`, { state });
}

export function openStockPage(
  navigate: NavigateFunction,
  tab: "outbound" | "inbound" | "transfer",
  options: {
    materialId?: string;
    searchParams?: Record<string, string | number | undefined | null>;
    materialBackTo: string;
    detailBackTo?: string;
    detailBackState?: unknown;
    fromLabel?: string;
  },
) {
  const params = new URLSearchParams({ tab });
  if (options.materialId) params.set("material_id", options.materialId);
  for (const [key, value] of Object.entries(options.searchParams ?? {})) {
    if (value != null && value !== "") params.set(key, String(value));
  }
  const state: StockNavState = {
    materialBackTo: options.materialBackTo,
    detailBackTo: options.detailBackTo,
    detailBackState: options.detailBackState,
    fromLabel: options.fromLabel,
  };
  const storageKey = options.materialId ? `stock:${options.materialId}` : "stock:page";
  saveNav(storageKey, state);
  navigate(`/stock?${params.toString()}`, { state });
}

export function openStockForMaterial(
  navigate: NavigateFunction,
  materialId: string,
  tab: "outbound" | "inbound" | "transfer",
  detailCtx: DetailNavState,
  options?: OpenStockOptions,
) {
  openStockPage(navigate, tab, {
    materialId,
    materialBackTo: options?.materialBackTo ?? `/materials/${materialId}`,
    detailBackTo: detailCtx.backTo,
    detailBackState: detailCtx.backState,
    fromLabel: detailCtx.fromLabel,
    searchParams: options?.searchParams,
  });
}

export function navigateAfterStockSubmit(
  navigate: NavigateFunction,
  materialId: string,
  stockState: StockNavState,
) {
  if (stockState.materialBackTo.startsWith("/materials/")) {
    openMaterialDetail(navigate, materialId, detailContextAfterStock(stockState));
    return;
  }
  navigate(
    stockState.materialBackTo,
    stockState.detailBackState !== undefined ? { state: stockState.detailBackState } : undefined,
  );
}

export function persistShelfNav(locationId: string, state: ShelfNavState) {
  saveNav(`shelf:${locationId}`, state);
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
