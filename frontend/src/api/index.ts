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
  AdminAudit,
  AdminOverview,
  AdminSystem,
  Category,
  InventoryItem,
  LowStockItem,
  MaterialDetail,
  Location,
  Material,
  PaginatedMaterials,
  RoleMeta,
  StockRequest,
  StockRequestStatus,
  StockRequestType,
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
  const url = `${apiConfig.baseUrl}${path}`;
  const resp = await fetch(url, {
    ...init,
    headers: { ...headers(), ...(init?.headers ?? {}) },
  });
  const contentType = resp.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const text = await resp.text();
    const snippet = text.replace(/\s+/g, " ").slice(0, 120);
    throw new Error(
      `API 返回的不是 JSON，请检查前端 VITE_API_BASE 或 /api 反向代理配置（${url}，HTTP ${resp.status}）：${snippet}`,
    );
  }
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
  major_category?: string;
  sub_category?: string;
  code?: string;
  unit: string;
  spec?: string;
  barcode?: string;
  default_location_id?: string;
    supplier?: string;
    min_stock?: number;
}) {
  return request<Material>("/materials", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function searchMaterials(
  q = "",
  opts?: {
    page?: number;
    size?: number;
    stockOnly?: boolean;
    searchBy?: "all" | "category" | "name" | "code";
  },
) {
  const params = new URLSearchParams({
    page: String(opts?.page ?? 1),
    size: String(opts?.size ?? 20),
  });
  if (q) params.set("q", q);
  if (opts?.stockOnly) params.set("stock_only", "true");
  if (opts?.searchBy) params.set("search_by", opts.searchBy);
  return request<PaginatedMaterials>(`/materials/search?${params}`);
}

export function listLocations() {
  return request<Location[]>("/locations");
}

export function createLocation(payload: { code: string; name: string; type: string }) {
  return request<Location>("/locations", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateLocation(
  id: string,
  payload: { code?: string; name?: string; type?: string },
) {
  return request<Location>(`/locations/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteLocation(id: string) {
  return request<{ deleted: boolean }>(`/locations/${id}`, {
    method: "DELETE",
  });
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

export function getAdminOverview(opts?: { startAt?: string; endAt?: string }) {
  const params = new URLSearchParams();
  if (opts?.startAt) params.set("start_at", opts.startAt);
  if (opts?.endAt) params.set("end_at", opts.endAt);
  const qs = params.toString();
  return request<AdminOverview>(`/admin/overview${qs ? `?${qs}` : ""}`);
}

export function getAdminAudit(opts?: { startAt?: string; endAt?: string; limit?: number }) {
  const params = new URLSearchParams();
  if (opts?.startAt) params.set("start_at", opts.startAt);
  if (opts?.endAt) params.set("end_at", opts.endAt);
  if (opts?.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  return request<AdminAudit>(`/admin/audit${qs ? `?${qs}` : ""}`);
}

export function getAdminSystem() {
  return request<AdminSystem>("/admin/system");
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

export function postPurchaseInbound(payload: {
  material_id: string;
  location_id: string;
  qty: number;
  idempotency_key: string;
  supplier?: string;
  note?: string;
}) {
  return request<{ transaction_id: string }>("/purchase-inbound", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function createStockRequest(payload: {
  type: StockRequestType;
  material_id: string;
  location_id: string;
  qty: number;
  idempotency_key: string;
  note: string;
}) {
  return request<{ request_id: string }>("/requests", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listMyRequests(opts?: {
  status?: StockRequestStatus;
  keyword?: string;
  limit?: number;
}) {
  const params = new URLSearchParams();
  if (opts?.status) params.set("status", opts.status);
  if (opts?.keyword) params.set("keyword", opts.keyword);
  if (opts?.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  return request<StockRequest[]>(`/requests/mine${qs ? `?${qs}` : ""}`);
}

export function listApprovalRequests(opts?: {
  status?: StockRequestStatus;
  keyword?: string;
  limit?: number;
}) {
  const params = new URLSearchParams();
  if (opts?.status) params.set("status", opts.status);
  if (opts?.keyword) params.set("keyword", opts.keyword);
  if (opts?.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  return request<StockRequest[]>(`/requests${qs ? `?${qs}` : ""}`);
}

export function approveStockRequest(id: string) {
  return request<StockRequest>(`/requests/${id}/approve`, {
    method: "POST",
  });
}

export function rejectStockRequest(id: string, reason: string) {
  return request<StockRequest>(`/requests/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export function listTransactions(opts?: {
  keyword?: string;
  operator?: string;
  startAt?: string;
  endAt?: string;
  limit?: number;
}) {
  const params = new URLSearchParams();
  if (opts?.keyword) params.set("keyword", opts.keyword);
  if (opts?.operator) params.set("operator", opts.operator);
  if (opts?.startAt) params.set("start_at", opts.startAt);
  if (opts?.endAt) params.set("end_at", opts.endAt);
  if (opts?.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  return request<Transaction[]>(`/transactions${qs ? `?${qs}` : ""}`);
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

export function postTransfer(payload: {
  material_id: string;
  from_location_id: string;
  to_location_id: string;
  qty: number;
  idempotency_key: string;
  note?: string;
}) {
  return request<{ transaction_ids: string[] }>("/transfer", {
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

export function listLowStock() {
  return request<LowStockItem[]>("/inventory/low-stock");
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
  return searchMaterials(q ?? "", { page: 1, size: 50 }).then((data) =>
    data.items.map((m) => ({ value: m.id, label: `${m.name} (${m.code})` })),
  );
}
