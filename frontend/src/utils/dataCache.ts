const store = new Map<string, { at: number; data: unknown }>();

export const META_CACHE_TTL_MS = 5 * 60 * 1000;
export const TX_FILTER_CACHE_TTL_MS = 60 * 1000;

export async function withCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs = META_CACHE_TTL_MS,
): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttlMs) {
    return hit.data as T;
  }
  const data = await fetcher();
  store.set(key, { at: Date.now(), data });
  return data;
}

export function invalidateDataCache(prefix?: string) {
  if (!prefix) {
    store.clear();
    return;
  }
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      store.delete(key);
    }
  }
}

export function prefetchModule(loader: () => Promise<unknown>) {
  void loader();
}
