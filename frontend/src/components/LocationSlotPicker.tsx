import { Form, Input } from "antd-mobile";
import { useEffect, useMemo, useState } from "react";
import { listInventory } from "../api";
import type { InventoryItem, Location } from "../api/types";
import {
  slotSelectionLabel,
  suggestDefaultSlot,
  type SlotSelection,
} from "../utils/inventorySlot";
import { isGridCapableLocation, resolveGridSize } from "../utils/shelfGrid";
import { LocationShelfGrid } from "./LocationShelfGrid";

interface LocationSlotPickerProps {
  location: Location;
  materialId?: string;
  value: SlotSelection;
  onChange: (next: SlotSelection) => void;
}

function parseManualSlotNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number.parseInt(trimmed, 10);
  return Number.isFinite(n) && n >= 1 && n <= 99 ? n : null;
}

export function LocationSlotPicker({ location, materialId, value, onChange }: LocationSlotPickerProps) {
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void listInventory(undefined, location.id)
      .then((items) => {
        if (!cancelled) setInventory(items);
      })
      .catch(() => {
        if (!cancelled) setInventory([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [location.id]);

  useEffect(() => {
    if (value.row != null) return;
    onChange(suggestDefaultSlot(location, inventory, materialId));
  }, [location.id, inventory, materialId, value.row, onChange, location]);

  const materialNames = useMemo(() => new Map<string, string>(), []);
  const needsColumn = useMemo(
    () => resolveGridSize(location, inventory).columns != null,
    [location, inventory],
  );

  if (!isGridCapableLocation(location)) return null;

  const label = value.label ?? slotSelectionLabel(value.row, value.column);

  const applyManual = (rowRaw: string, columnRaw?: string) => {
    const row = parseManualSlotNumber(rowRaw);
    const column = needsColumn ? parseManualSlotNumber(columnRaw ?? "") : null;
    if (row == null) {
      onChange({ row: null, column: needsColumn ? column : null });
      return;
    }
    if (needsColumn && column == null) {
      onChange({ row, column: null });
      return;
    }
    onChange({
      row,
      column: needsColumn ? column : null,
      label: slotSelectionLabel(row, needsColumn ? column : null),
    });
  };

  return (
    <div className="location-slot-picker">
      <div className="location-slot-picker-head">
        <span className="location-slot-picker-label">具体位置</span>
        <span className="location-slot-picker-value">{loading ? "加载格位…" : label}</span>
      </div>
      <Form layout="horizontal" className="location-slot-picker-manual">
        <Form.Item label={needsColumn ? "行号" : "层号"}>
          <Input
            type="number"
            inputMode="numeric"
            placeholder={needsColumn ? "行 / 层" : "层号"}
            value={value.row != null ? String(value.row) : ""}
            onChange={(v) => applyManual(v, value.column != null ? String(value.column) : "")}
            clearable
          />
        </Form.Item>
        {needsColumn && (
          <Form.Item label="列号">
            <Input
              type="number"
              inputMode="numeric"
              placeholder="列号"
              value={value.column != null ? String(value.column) : ""}
              onChange={(v) => applyManual(value.row != null ? String(value.row) : "", v)}
              clearable
            />
          </Form.Item>
        )}
      </Form>
      <p className="stock-hint location-slot-picker-hint">可点选下方格位，或直接输入{needsColumn ? "行号、列号" : "层号"}</p>
      {loading ? (
        <p className="stock-hint">正在加载该库位格位图…</p>
      ) : (
        <LocationShelfGrid
          location={location}
          inventory={inventory}
          materialNames={materialNames}
          pickMode
          compact
          legendMode="inbound"
          highlightMaterialId={materialId}
          selectedSlot={value}
          onCellClick={(cell) => {
            if (cell.row < 1) return;
            onChange({
              row: cell.row,
              column: cell.column,
              label: cell.label,
            });
          }}
        />
      )}
    </div>
  );
}

export function emptySlotSelection(): SlotSelection {
  return { row: null, column: null };
}
