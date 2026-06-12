import { apiConfig } from "./config";
import { getAuthToken } from "../auth/token";
import type {
  ApiEnvelope,
  InventoryItem,
  MaterialDetail,
  Location,
  PaginatedMaterials,
  RoleMeta,
  Transaction,
  User,
} from "./types";

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${apiConfig.baseUrl}${path}`, {
    ...init,
    headers: { ...headers(), ...(init?.headers ?? {}) },
  });
  const body = (await resp.json()) as ApiEnvelope<T> & { detail?: string };
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

export function searchMaterials(q: string, page = 1, size = 20) {
  const params = new URLSearchParams({ page: String(page), size: String(size) });
  if (q) params.set("q", q);
  return request<PaginatedMaterials>(`/materials/search?${params}`);
}

export function listLocations() {
  return request<Location[]>("/locations");
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
