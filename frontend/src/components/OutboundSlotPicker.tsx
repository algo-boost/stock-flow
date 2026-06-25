import { useEffect, useMemo, useState } from "react";
import { listInventory, listLocations } from "../api";
import type { InventoryItem, Location } from "../api/types";
import { inventorySlotKey, parseInventorySlotKey } from "../utils/inventoryDisplay";
import { type SlotSelection } from "../utils/inventorySlot";
import { isGridCapableLocation } from "../utils/shelfGrid";
import { LocationShelfGrid } from "./LocationShelfGrid";

interface OutboundSlotPickerProps {
  materialId: string;
  materialInventory: InventoryItem[];
  locationId: string;
  slotKey: string;
  onLocationChange: (locationId: string) => void;
  onSlotKeyChange: (slotKey: string) => void;
}

function slotKeyFromCell(materialId: string, cell: { row: number; column: number | null; items: InventoryItem[] }): string | null {
  const item = cell.items.find((row) => row.material_id === materialId && row.quantity > 0);
  if (!item) return null;
  return inventorySlotKey(item);
}

function slotSelectionFromKey(slotKey: string): SlotSelection {
  const parsed = parseInventorySlotKey(slotKey);
  return {
    row: parsed.row ?? null,
    column: parsed.column ?? null,
  };
}

export function OutboundSlotPicker({
  materialId,
  materialInventory,
  locationId,
  slotKey,
  onLocationChange,
  onSlotKeyChange,
}: OutboundSlotPickerProps) {
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationInventory, setLocationInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void listLocations()
      .then(setLocations)
      .catch(() => setLocations([]));
  }, []);

  useEffect(() => {
    if (!locationId) {
      setLocationInventory([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void listInventory(undefined, locationId)
      .then((items) => {
        if (!cancelled) setLocationInventory(items);
      })
      .catch(() => {
        if (!cancelled) setLocationInventory([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [locationId]);

  const locationGroups = useMemo(() => {
    const map = new Map<string, { locationId: string; name: string; totalQty: number }>();
    for (const item of materialInventory) {
      const current = map.get(item.location_id);
      if (current) {
        current.totalQty += item.quantity;
      } else {
        map.set(item.location_id, {
          locationId: item.location_id,
          name: item.location_name ?? item.location_id,
          totalQty: item.quantity,
        });
      }
    }
    return Array.from(map.values());
  }, [materialInventory]);

  const selectedLocation = locations.find((loc) => loc.id === locationId);
  const showGrid = Boolean(selectedLocation && isGridCapableLocation(selectedLocation));
  const slotsAtLocation = materialInventory.filter((item) => item.location_id === locationId);
  const materialNames = useMemo(() => new Map<string, string>(), []);

  return (
    <div className="outbound-slot-picker">
      <div className="outbound-location-list">
        <div className="outbound-location-list-title">有货库位（{locationGroups.length}）</div>
        <div className="outbound-location-chips">
          {locationGroups.map((group) => (
            <button
              key={group.locationId}
              type="button"
              className={`outbound-location-chip${locationId === group.locationId ? " outbound-location-chip-active" : ""}`}
              onClick={() => onLocationChange(group.locationId)}
            >
              <span className="outbound-location-chip-name">{group.name}</span>
              <span className="outbound-location-chip-qty">{group.totalQty} 件</span>
            </button>
          ))}
        </div>
      </div>

      {showGrid && selectedLocation ? (
        loading ? (
          <p className="stock-hint">正在加载格位图…</p>
        ) : (
          <LocationShelfGrid
            location={selectedLocation}
            inventory={locationInventory}
            materialNames={materialNames}
            outboundPickMode
            compact
            legendMode="outbound"
            highlightMaterialId={materialId}
            selectedSlot={slotSelectionFromKey(slotKey)}
            onCellClick={(cell) => {
              const nextKey = slotKeyFromCell(materialId, cell);
              if (nextKey) onSlotKeyChange(nextKey);
            }}
          />
        )
      ) : (
        <div className="outbound-flat-slots">
          <div className="outbound-flat-slots-title">可选格位</div>
          {slotsAtLocation.map((item) => {
            const key = inventorySlotKey(item);
            const active = slotKey === key;
            const label =
              item.row != null && item.column != null
                ? `${item.row} 层 · ${item.column} 列`
                : item.row != null
                  ? `第 ${item.row} 层`
                  : "未指定格位";
            return (
              <button
                key={key}
                type="button"
                className={`outbound-flat-slot${active ? " outbound-flat-slot-active" : ""}`}
                onClick={() => onSlotKeyChange(key)}
              >
                <span>{label}</span>
                <span>{item.quantity} 件</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function pickDefaultOutboundLocation(materialInventory: InventoryItem[], slotKey: string): string {
  const parsed = parseInventorySlotKey(slotKey);
  if (parsed.location_id && materialInventory.some((item) => item.location_id === parsed.location_id)) {
    return parsed.location_id;
  }
  return materialInventory[0]?.location_id ?? "";
}
