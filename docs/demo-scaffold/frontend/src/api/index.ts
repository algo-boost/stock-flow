/** localStorage 缓存层 —— GET 请求优先读缓存，命中瞬间返回 */
const PREFIX = "sc_";

function cacheGet(key: string): any | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const { data, expires } = JSON.parse(raw);
    if (Date.now() > expires) { localStorage.removeItem(PREFIX + key); return null; }
    return data;
  } catch { return null; }
}

function cacheSet(key: string, data: any, ttlSeconds: number = 60) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ data, expires: Date.now() + ttlSeconds * 1000 }));
  } catch { /* quota exceeded, ignore */ }
}

function cacheClearLike(pattern: string) {
  const keys = Object.keys(localStorage).filter(k => k.startsWith(PREFIX) && k.includes(pattern));
  keys.forEach(k => localStorage.removeItem(k));
}

/** 统一请求 */
const BASE = "/api";
const AUTH_HEADER = () => {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export async function request<T = any>(
  method: string, path: string, body?: any, ttlSeconds?: number
): Promise<T> {
  const url = BASE + path;
  const cacheKey = `${method}:${path}`;

  // GET 优先读缓存
  if (method === "GET" && ttlSeconds && ttlSeconds > 0) {
    const cached = cacheGet(cacheKey);
    if (cached) return cached as T;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Mock-Role": "ADMIN",  // mock 模式
    ...AUTH_HEADER(),
  };

  const resp = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await resp.json();

  if (json.code === 0) {
    if (method === "GET" && ttlSeconds && ttlSeconds > 0) {
      cacheSet(cacheKey, json.data, ttlSeconds);
    }
    // 写操作清理相关缓存
    if (method !== "GET") {
      cacheClearLike("GET:" + path.split("/")[1] || "");
    }
    return json.data as T;
  }

  throw new Error(json.message || `HTTP ${resp.status}`);
}

// ── 物料 API ──
export const searchMaterials = (q: string, page = 1, size = 20) =>
  request("GET", `/materials/search?q=${encodeURIComponent(q)}&page=${page}&size=${size}`, undefined, 30);

export const getMaterialCatalog = () =>
  request("GET", "/materials/catalog", undefined, 60);

export const getCategories = () =>
  request("GET", "/materials/categories", undefined, 300);

export const getMaterial = (id: string) =>
  request("GET", `/materials/${id}`, undefined, 120);

export const createMaterial = (payload: any) =>
  request("POST", "/materials", payload);

// ── 库存 API ──
export const getLocations = () =>
  request("GET", "/locations", undefined, 300);

export const getInventory = () =>
  request("GET", "/inventory", undefined, 30);

// ── 认证 API ──
export const getMe = () =>
  request("GET", "/me");

export const healthCheck = () =>
  request("GET", "/health");
