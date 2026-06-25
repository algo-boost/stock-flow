import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { invalidateDataCache } from "./dataCache";

export type DataMutationScope =
  | "locations"
  | "categories"
  | "materials"
  | "inventory"
  | "transactions"
  | "requests"
  | "returns"
  | "all";

const MUTATION_EVENT = "stock-flow:data-mutated";

const GET_PATHS_BY_SCOPE: Record<Exclude<DataMutationScope, "all">, string[]> = {
  locations: ["/locations", "/inventory", "/inventory/staging"],
  categories: ["/materials/categories"],
  materials: ["/materials"],
  inventory: ["/inventory"],
  transactions: ["/transactions"],
  requests: ["/requests"],
  returns: ["/returns"],
};

/** 清除 request() 写入 localStorage 的 GET 缓存 */
export function clearLocalGetCache(pathPrefixes?: string[]) {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (!key?.startsWith("lf_cache:")) continue;
    const cachedPath = key.slice("lf_cache:".length).split("?")[0];
    if (!pathPrefixes) {
      localStorage.removeItem(key);
      continue;
    }
    if (pathPrefixes.some((prefix) => cachedPath === prefix || cachedPath.startsWith(`${prefix}/`))) {
      localStorage.removeItem(key);
    }
  }
}

function invalidateMemoryCache(scopes: DataMutationScope[]) {
  const set = new Set(scopes);
  if (set.has("all")) {
    invalidateDataCache();
    return;
  }
  if (set.has("locations") || set.has("inventory")) {
    invalidateDataCache("meta:locations");
    invalidateDataCache("meta:inventory");
    invalidateDataCache("meta:home-browse");
    invalidateDataCache("meta:home-bundle");
    invalidateDataCache("meta:shelf-bundle");
  }
  if (set.has("categories") || set.has("materials")) {
    invalidateDataCache("meta:categories");
    invalidateDataCache("meta:home-browse");
    invalidateDataCache("meta:home-bundle");
    invalidateDataCache("meta:shelf-bundle");
  }
  if (set.has("transactions") || set.has("requests") || set.has("returns")) {
    invalidateDataCache("tx:");
  }
}

export function notifyDataMutation(...scopes: DataMutationScope[]) {
  const effective = scopes.includes("all") ? (["all"] as DataMutationScope[]) : scopes;
  if (effective.includes("all")) {
    clearLocalGetCache();
    invalidateMemoryCache(["all"]);
  } else {
    const prefixes = new Set<string>();
    for (const scope of effective) {
      if (scope === "all") continue;
      for (const prefix of GET_PATHS_BY_SCOPE[scope]) prefixes.add(prefix);
    }
    clearLocalGetCache([...prefixes]);
    invalidateMemoryCache(effective);
  }
  window.dispatchEvent(new CustomEvent(MUTATION_EVENT, { detail: { scopes: effective } }));
}

export function invalidateAfterApiWrite(path: string) {
  const normalized = path.split("?")[0];
  const scopes = scopesForWritePath(normalized);
  if (scopes.length > 0) notifyDataMutation(...scopes);
}

function scopesForWritePath(path: string): DataMutationScope[] {
  if (path.startsWith("/materials/categories")) return ["categories"];
  if (path.startsWith("/materials/") && path.includes("/inventory/")) return ["inventory", "materials"];
  if (path.startsWith("/materials/")) return ["materials", "inventory"];
  if (path.startsWith("/locations")) return ["locations", "inventory"];
  if (path.startsWith("/admin/location-types")) return ["locations"];
  if (path.startsWith("/admin/inventory")) return ["inventory", "materials"];
  if (path === "/inbound" || path.startsWith("/purchase")) return ["inventory", "materials", "transactions"];
  if (path === "/outbound" || path === "/transfer") return ["inventory", "materials", "transactions"];
  if (path.startsWith("/requests")) return ["requests", "inventory", "materials", "transactions"];
  if (path.startsWith("/returns")) return ["returns", "inventory", "transactions"];
  if (path.startsWith("/transactions")) return ["transactions", "inventory", "materials"];
  if (path.startsWith("/admin")) return ["all"];
  return [];
}

export function useDataMutationRefetch(
  scopes: DataMutationScope[],
  refetch: () => void | Promise<void>,
  enabled = true,
) {
  const scopeKey = scopes.join("|");

  useEffect(() => {
    if (!enabled) return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ scopes: DataMutationScope[] }>).detail;
      const hit = detail.scopes.some((scope) => scope === "all" || scopes.includes(scope));
      if (hit) void refetch();
    };
    window.addEventListener(MUTATION_EVENT, handler);
    return () => window.removeEventListener(MUTATION_EVENT, handler);
  }, [enabled, refetch, scopeKey]);
}

/** 列表页：路由返回 + 数据变更后自动刷新 */
export function useLiveListData(
  refetch: () => void | Promise<void>,
  options?: {
    scopes?: DataMutationScope[];
    active?: boolean;
  },
) {
  const { scopes = [], active = true } = options ?? {};
  const location = useLocation();

  useEffect(() => {
    if (!active) return;
    void refetch();
  }, [active, refetch, location.pathname, location.search]);

  useDataMutationRefetch(scopes, refetch, active);
}
