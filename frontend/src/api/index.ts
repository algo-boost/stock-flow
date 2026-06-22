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
  PendingReturn,
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

function formatValidationDetail(detail: unknown): string | undefined {
  if (typeof detail === "string") return detail;
  if (!Array.isArray(detail)) return undefined;
  const messages = detail
    .map((item) => {
      if (typeof item !== "object" || item === null) return "";
      const msg = "msg" in item && typeof item.msg === "string" ? item.msg : "";
      const loc = "loc" in item && Array.isArray(item.loc) ? item.loc.join(".") : "";
      return loc ? `${loc}: ${msg}` : msg;
    })
    .filter(Boolean);
  return messages.length ? messages.join("；") : undefined;
}

async function request<T>(path: string, init?: RequestInit, retryOnUnauthorized = true): Promise<T> {
  let { resp, body } = await fetchJson<T>(path, init);
  if (retryOnUnauthorized && isUnauthorized(resp, body) && isFeishuClient()) {
    await reauthWithFeishu();
    ({ resp, body } = await fetchJson<T>(path, init));
  }
  if (!resp.ok || body.code !== 0) {
    const detail =
      typeof body.detail === "string"
        ? body.detail
        : formatValidationDetail((body as { detail?: unknown }).detail);
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

export function createCategory(payload: {
  name: string;
  parent_id?: string | null;
  default_location_type?: string;
  examples?: string;
}) {
  return request<Category>("/materials/categories", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteCategory(categoryId: string) {
  return request<{ deleted: boolean }>(`/materials/categories/${categoryId}`, {
    method: "DELETE",
  });
}

export function updateCategory(
  categoryId: string,
  payload: { name?: string; parent_id?: string | null },
) {
  return request<Category>(`/materials/categories/${categoryId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function updateMaterial(
  materialId: string,
  payload: {
    name?: string;
    category_id?: string;
    major_category?: string;
    mid_category?: string;
    sub_category?: string;
    code?: string;
    unit?: string;
    spec?: string;
    barcode?: string;
    default_location_id?: string;
    supplier?: string;
    min_stock?: number;
  },
) {
  return request<Material>(`/materials/${materialId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteMaterial(materialId: string) {
  return request<{ deleted: boolean }>(`/materials/${materialId}`, {
    method: "DELETE",
  });
}

export function createMaterial(payload: {
  name: string;
  category_id: string;
  major_category?: string;
  mid_category?: string;
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
    category?: string;
  },
) {
  const params = new URLSearchParams({
    page: String(opts?.page ?? 1),
    size: String(opts?.size ?? 20),
  });
  if (q) params.set("q", q);
  if (opts?.stockOnly) params.set("stock_only", "true");
  if (opts?.searchBy) params.set("search_by", opts.searchBy);
  if (opts?.category) params.set("category", opts.category);
  return request<PaginatedMaterials>(`/materials/search?${params}`);
}

export function listLocations() {
  return request<Location[]>("/locations");
}

export function createLocation(payload: { code: string; name: string; type: string; parent_id?: string }) {
  return request<Location>("/locations", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateLocation(
  id: string,
  payload: { code?: string; name?: string; type?: string; parent_id?: string | null },
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

// ── 库位类型管理 ──

export function listLocationTypes() {
  return request<string[]>("/admin/location-types");
}

export function addLocationType(name: string) {
  return request<string[]>(`/admin/location-types?name=${encodeURIComponent(name)}`, { method: "POST" });
}

export function removeLocationType(name: string) {
  return request<string[]>(`/admin/location-types?name=${encodeURIComponent(name)}`, { method: "DELETE" });
}

export function updateLocationType(oldName: string, newName: string) {
  return request<string[]>(`/admin/location-types?old_name=${encodeURIComponent(oldName)}&new_name=${encodeURIComponent(newName)}`, { method: "PATCH" });
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

// ── SQLite 本地缓存同步 ──

export function syncSqliteCache() {
  return request<{ synced: boolean; tables: Record<string, number | string>; snapshot: Record<string, number> }>(
    "/admin/sqlite-sync",
    { method: "POST" },
  );
}

export function getSqliteCacheStatus() {
  return request<{ enabled: boolean; snapshot?: Record<string, number>; sync_interval?: number }>(
    "/admin/sqlite-status",
  );
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
  return_required: boolean;
  return_due_at?: string;
  row?: number;
  column?: number;
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
  location_id?: string;
  qty: number;
  idempotency_key: string;
  note: string;
  return_required?: boolean;
  return_due_at?: string;
  row?: number;
  column?: number;
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

export function approveStockRequest(
  id: string,
  payload?: {
    location_id?: string;
    row?: number;
    column?: number;
  },
) {
  return request<StockRequest>(`/requests/${id}/approve`, {
    method: "POST",
    body: JSON.stringify(payload ?? {}),
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

export function listPendingReturns(borrower?: string) {
  const params = new URLSearchParams();
  if (borrower?.trim()) params.set("borrower", borrower.trim());
  const qs = params.toString();
  return request<PendingReturn[]>(`/returns/pending${qs ? `?${qs}` : ""}`);
}

export function postInbound(payload: {
  material_id: string;
  location_id: string;
  qty: number;
  idempotency_key: string;
  note?: string;
  spec?: string;
  row?: number;
  column?: number;
}) {
  return request<{ transaction_id: string }>("/inbound", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateInventorySlot(
  materialId: string,
  locationId: string,
  payload: { row: number; column: number; from_row?: number; from_column?: number },
) {
  return request<InventoryItem>(`/materials/${materialId}/inventory/${locationId}/slot`, {
    method: "PATCH",
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
  to_row?: number;
  to_column?: number;
  from_row?: number;
  from_column?: number;
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
