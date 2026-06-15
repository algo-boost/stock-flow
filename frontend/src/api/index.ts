import { apiConfig } from "./config";
import {
  consumePostLoginRedirect,
  feishuLogin,
  isFeishuClient,
  redirectToLoginHomeIfNeeded,
} from "../auth/feishu";
import { clearAuthToken, getAuthToken } from "../auth/token";
import type {
  ApiEnvelope,
  Category,
  InventoryItem,
  MaterialDetail,
  Location,
  Material,
  PaginatedMaterials,
  RoleMeta,
  Transaction,
  User,
} from "./types";

let reauthPromise: Promise<void> | null = null;

function headers(): HeadersInit {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const token = getAuthToken();
  if (token) {
    h.Authorization = `Bearer ${token}`;
  } else if (apiConfig.useMockAuth) {
    h["X-Mock-Role"] = apiConfig.mockRole;
    h["X-Mock-User"] = "h5_dev_user";
  }
  return h;
}

function isUnauthorized(resp: Response, body: { code?: number; message?: string }): boolean {
  return (
    resp.status === 401 ||
    body.code === 401 ||
    body.message?.includes("登录已过期") === true ||
    body.message?.includes("未登录") === true
  );
}

async function reauthWithFeishu(): Promise<void> {
  if (!isFeishuClient()) {
    return;
  }
  if (!redirectToLoginHomeIfNeeded()) {
    throw new Error("登录已过期，正在自动重新登录…");
  }
  if (!reauthPromise) {
    reauthPromise = (async () => {
      clearAuthToken();
      await feishuLogin();
      consumePostLoginRedirect();
    })().finally(() => {
      reauthPromise = null;
    });
  }
  await reauthPromise;
}

async function fetchJson<T>(
  path: string,
  init?: RequestInit,
): Promise<{ resp: Response; body: ApiEnvelope<T> & { detail?: string } }> {
  const resp = await fetch(`${apiConfig.baseUrl}${path}`, {
    ...init,
    headers: { ...headers(), ...(init?.headers ?? {}) },
  });
  const body = (await resp.json()) as ApiEnvelope<T> & { detail?: string };
  return { resp, body };
}

async function request<T>(path: string, init?: RequestInit, retryOnUnauthorized = true): Promise<T> {
  let { resp, body } = await fetchJson<T>(path, init);
  if (retryOnUnauthorized && isUnauthorized(resp, body) && isFeishuClient()) {
    await reauthWithFeishu();
    ({ resp, body } = await fetchJson<T>(path, init));
  }
  if (!resp.ok || body.code !== 0) {
    const detail = typeof body.detail === "string" ? body.detail : undefined;
    throw new Error(body.message || detail || `请求失败 (${resp.status})`);
  }
  return body.data;
}

export function getMe() {
  return request<{ user: User; role_meta?: RoleMeta | null }>("/me");
}

export function getMaterialCatalog(opts?: { stockOnly?: boolean; q?: string }) {
  const params = new URLSearchParams();
  if (opts?.stockOnly) params.set("stock_only", "true");
  if (opts?.q) params.set("q", opts.q);
  const qs = params.toString();
  return request<MaterialDetail[]>(`/materials/catalog${qs ? `?${qs}` : ""}`);
}

export function listCategories() {
  return request<Category[]>("/materials/categories");
}

export function createMaterial(payload: {
  name: string;
  category_id: string;
  code?: string;
  unit: string;
  spec?: string;
  barcode?: string;
  default_location_id?: string;
}) {
  return request<Material>("/materials", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function searchMaterials(q: string, page = 1, size = 20) {
  const params = new URLSearchParams({ page: String(page), size: String(size) });
  if (q) params.set("q", q);
  return request<PaginatedMaterials>(`/materials/search?${params}`);
}

export function listLocations() {
  return request<Location[]>("/locations");
}

export function refreshBitableCache() {
  return request<{
    message: string;
    tables: Record<string, number>;
    refreshed?: string[];
    failed?: Record<string, string>;
  }>("/admin/cache/refresh", {
    method: "POST",
  });
}

export function getMaterial(id: string) {
  return request<MaterialDetail>(`/materials/${id}`);
}

export function getMaterialTransactions(id: string, limit = 20) {
  return request<Transaction[]>(`/materials/${id}/transactions?limit=${limit}`);
}

export function postOutbound(payload: {
  material_id: string;
  location_id: string;
  qty: number;
  idempotency_key: string;
  note: string;
}) {
  return request<{ transaction_id: string }>("/outbound", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function postInbound(payload: {
  material_id: string;
  location_id: string;
  qty: number;
  idempotency_key: string;
  note?: string;
}) {
  return request<{ transaction_id: string }>("/inbound", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listInventory(materialId?: string, locationId?: string) {
  const params = new URLSearchParams();
  if (materialId) params.set("material_id", materialId);
  if (locationId) params.set("location_id", locationId);
  const qs = params.toString();
  return request<InventoryItem[]>(`/inventory${qs ? `?${qs}` : ""}`);
}

export function listLocationsForPicker() {
  return listInventory().then((items) => {
    const map = new Map<string, string>();
    for (const item of items) {
      map.set(item.location_id, item.location_name ?? item.location_id);
    }
    return Array.from(map.entries()).map(([value, label]) => ({ value, label }));
  });
}

export function searchMaterialsForPicker(q?: string) {
  return searchMaterials(q ?? "", 1, 50).then((data) =>
    data.items.map((m) => ({ value: m.id, label: `${m.name} (${m.code})` })),
  );
}
