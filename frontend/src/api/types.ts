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
  unit: string;
  spec?: string;
  barcode?: string;
  default_location_id?: string | null;
}

export interface MaterialSearchItem extends Material {
  total_quantity: number;
  locations_summary?: string | null;
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

export interface PaginatedMaterials {
  items: MaterialSearchItem[];
  total: number;
  page: number;
  size: number;
}
