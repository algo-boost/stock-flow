import type { Location } from "../api/types";

export function getLocationChildren(locations: Location[], parentId: string | null): Location[] {
  return locations
    .filter((item) => (item.parent_id ?? null) === parentId)
    .sort((a, b) => a.name.localeCompare(b.name, "zh"));
}

export function getLocationPath(locations: Location[], locationId: string | null): Location[] {
  if (!locationId) return [];
  const map = new Map(locations.map((item) => [item.id, item]));
  const path: Location[] = [];
  let current = map.get(locationId);
  while (current) {
    path.unshift(current);
    current = current.parent_id ? map.get(current.parent_id) : undefined;
  }
  return path;
}

export function getDescendantIds(locations: Location[], locationId: string): Set<string> {
  const ids = new Set<string>([locationId]);
  for (const child of getLocationChildren(locations, locationId)) {
    for (const id of getDescendantIds(locations, child.id)) {
      ids.add(id);
    }
  }
  return ids;
}

export function formatLocationPath(locations: Location[], locationId: string | null): string {
  if (!locationId) return "";
  return getLocationPath(locations, locationId)
    .map((item) => item.name)
    .join(" / ");
}
