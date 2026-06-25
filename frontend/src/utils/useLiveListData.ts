import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import type { DataMutationScope } from "./dataMutation";

const MUTATION_EVENT = "stock-flow:data-mutated";

export function useDataMutationRefetch(
  scopes: DataMutationScope[],
  refetch: () => void | Promise<void>,
  enabled = true,
) {
  const scopesKey = scopes.join(",");
  useEffect(() => {
    if (!enabled) return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ scopes: DataMutationScope[] }>).detail;
      if (!detail?.scopes?.some((s) => s === "all" || scopes.includes(s))) return;
      void refetch();
    };
    window.addEventListener(MUTATION_EVENT, handler);
    return () => window.removeEventListener(MUTATION_EVENT, handler);
  }, [scopesKey, refetch, enabled]);
}

/**
 * 列表/元数据在以下时机自动刷新：
 * - 面板变为 active
 * - 路由 pathname/search 变化（从子页返回时）
 * - 其它页面写入数据后触发 mutation 事件
 */
export function useLiveListData(
  refetch: () => void | Promise<void>,
  options?: {
    scopes?: DataMutationScope[];
    active?: boolean;
    watchRoute?: boolean;
  },
) {
  const { scopes = [], active = true, watchRoute = false } = options ?? {};
  const location = useLocation();
  const routeSig = watchRoute ? `${location.pathname}${location.search}` : "";

  useEffect(() => {
    if (!active) return;
    void refetch();
  }, [active, refetch, routeSig]);

  useDataMutationRefetch(scopes, refetch, active);
}
