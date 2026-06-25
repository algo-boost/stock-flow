import {
  listCategories,
  listInventory,
  listLocations,
  listTransactions,
  searchMaterials,
} from "../api";
import type { Category, InventoryItem, Location, PaginatedMaterials, PaginatedTransactions } from "../api/types";
import type { DateRangePreset } from "./historyDisplay";
import { resolveDateRange } from "./historyDisplay";
import { META_CACHE_TTL_MS, TX_FILTER_CACHE_TTL_MS, withCache } from "./dataCache";

export function fetchCategoriesCached(): Promise<Category[]> {
  return withCache("meta:categories", listCategories, META_CACHE_TTL_MS);
}

export function fetchLocationsCached(): Promise<Location[]> {
  return withCache("meta:locations", listLocations, META_CACHE_TTL_MS);
}

export function fetchInventoryCached(): Promise<InventoryItem[]> {
  return withCache("meta:inventory", listInventory, META_CACHE_TTL_MS);
}

export function fetchHomeBrowseMetaCached(): Promise<{
  categories: Category[];
  locations: Location[];
}> {
  return withCache(
    "meta:home-browse",
    async () => {
      const [categories, locations] = await Promise.all([listCategories(), listLocations()]);
      return { categories, locations };
    },
    META_CACHE_TTL_MS,
  );
}

export function fetchHomeMetaCached(): Promise<{
  categories: Category[];
  locations: Location[];
  inventory: InventoryItem[];
}> {
  return withCache(
    "meta:home-bundle",
    async () => {
      const [categories, locations, inventory] = await Promise.all([
        listCategories(),
        listLocations(),
        listInventory(),
      ]);
      return { categories, locations, inventory };
    },
    META_CACHE_TTL_MS,
  );
}

export function fetchShelfMetaCached(): Promise<{
  locations: Location[];
  inventory: InventoryItem[];
  materials: PaginatedMaterials;
}> {
  return withCache(
    "meta:shelf-bundle",
    async () => {
      const [locations, inventory, materials] = await Promise.all([
        listLocations(),
        listInventory(),
        searchMaterials("", { page: 1, size: 100 }),
      ]);
      return { locations, inventory, materials };
    },
    META_CACHE_TTL_MS,
  );
}

export function fetchInboundMaterialIdsCached(
  preset: DateRangePreset,
  customStart: string,
  customEnd: string,
): Promise<Set<string>> {
  const range = resolveDateRange(preset, customStart, customEnd);
  const cacheKey = `tx:inbound-ids:${preset}:${customStart}:${customEnd}:${range.startAt ?? ""}:${range.endAt ?? ""}`;
  return withCache(
    cacheKey,
    async () => {
      const data: PaginatedTransactions = await listTransactions({
        ...range,
        page: 1,
        size: 500,
      });
      return new Set(data.items.filter((t) => t.type.includes("入")).map((t) => t.material_id));
    },
    TX_FILTER_CACHE_TTL_MS,
  );
}
