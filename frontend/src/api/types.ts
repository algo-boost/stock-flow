export type Role = "ADMIN" | "KEEPER" | "USER";

export interface RoleMeta {
  source?: "group" | "override" | "default";
  method?: string | null;
  warning?: string | null;
  permission_url?: string | null;
}

export interface Location {
  id: string;
  code: string;
  name: string;
  type: string;
}

export interface Category {
  id: string;
  name: string;
  parent_id?: string | null;
  major_name?: string | null;
  sub_name?: string | null;
  default_location_type?: string | null;
  examples?: string | null;
}

export interface User {
  open_id: string;
  name: string;
  role: Role;
}

export interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
}

export interface Material {
  id: string;
  code: string;
  name: string;
  category_id: string;
  category_name?: string;
  major_category?: string | null;
  sub_category?: string | null;
  unit: string;
  spec?: string;
  barcode?: string;
  default_location_id?: string | null;
  supplier?: string | null;
  min_stock: number;
}

export interface MaterialSearchItem extends Material {
  total_quantity: number;
  locations_summary?: string | null;
}

export interface LowStockItem extends MaterialSearchItem {
  threshold: number;
}

export interface InventoryItem {
  material_id: string;
  location_id: string;
  location_name?: string;
  quantity: number;
}

export interface MaterialDetail {
  material: Material;
  inventory: InventoryItem[];
  total_quantity: number;
}

export interface Transaction {
  id: string;
  type: string;
  material_id: string;
  material_name?: string;
  location_id: string;
  location_name?: string;
  quantity: number;
  operator: string;
  remark?: string;
  created_at: string;
}

export type StockRequestType = "入库" | "出库";
export type StockRequestStatus = "待审批" | "已通过" | "已拒绝";

export interface StockRequest {
  id: string;
  type: StockRequestType;
  status: StockRequestStatus;
  material_id: string;
  material_name?: string | null;
  location_id: string;
  location_name?: string | null;
  quantity: number;
  requester_open_id: string;
  requester_name: string;
  approver_open_id?: string | null;
  approver_name?: string | null;
  remark?: string | null;
  reject_reason?: string | null;
  transaction_id?: string | null;
  created_at: string;
  reviewed_at?: string | null;
}

export interface PaginatedMaterials {
  items: MaterialSearchItem[];
  total: number;
  page: number;
  size: number;
}

export interface AdminOverview {
  period: { start_at?: string | null; end_at?: string | null };
  tables: Record<string, number>;
  totals: {
    inventory_quantity: number;
    inventory_records: number;
    transaction_count: number;
    inbound_quantity: number;
    outbound_quantity: number;
    pending_requests: number;
    approved_requests: number;
    rejected_requests: number;
    low_stock_count: number;
  };
  recent_transactions: Transaction[];
  recent_requests: StockRequest[];
  low_stock_items: LowStockItem[];
}

export interface AdminAudit {
  recent_transactions: Transaction[];
  recent_requests: StockRequest[];
  operator_counts: Record<string, number>;
  period: { start_at?: string | null; end_at?: string | null };
  role_check?: Record<string, unknown>;
}

export interface AdminSystem {
  app_env: string;
  bitable_mode: string;
  bitable_configured: boolean;
  feishu_configured: boolean;
  mock_auth_enabled: boolean;
  bitable_cache_ttl_seconds: number;
  bitable_warmup_on_startup: boolean;
  session_ttl_seconds: number;
  role_cache_ttl_seconds: number;
  role_check: Record<string, unknown>;
  tables: Record<string, number>;
  server_time: string;
}
