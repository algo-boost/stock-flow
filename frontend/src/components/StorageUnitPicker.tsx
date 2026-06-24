import { useMemo, useRef, useState } from "react";
import { Popup } from "antd-mobile";
import { useNavigate } from "react-router-dom";
import type { InventoryItem, Location } from "../api/types";
import { LocationShelfGrid } from "./LocationShelfGrid";
import { getLocationChildren, getLocationPath } from "../utils/locationTree";
import { buildShelfCells, isGridCapableLocation, resolveGridSize } from "../utils/shelfGrid";

interface StorageUnitPickerProps {
  locations: Location[];
  inventory: InventoryItem[];
  folderId: string | null;
  canInbound?: boolean;
  onSelect: (location: Location) => void;
  onNavigate: (locationId: string | null) => void;
}

function locationStats(inventory: InventoryItem[], locationId: string) {
  const items = inventory.filter((item) => item.location_id === locationId && item.quantity > 0);
  return {
    kindCount: new Set(items.map((item) => item.material_id)).size,
    stockQty: items.reduce((sum, item) => sum + item.quantity, 0),
  };
}

function isCabinetType(type: string): boolean {
  return type.includes("柜");
}

function MiniCabinetPreview({
  rows,
  columns,
  filledKeys,
}: {
  rows: number;
  columns: number;
  filledKeys: Set<string>;
}) {
  const scale = Math.min(1, 52 / Math.max(rows * 7, columns * 5));

  return (
    <div
      className="unit-mini unit-mini-cabinet unit-mini-scaled"
      style={{ transform: `scale(${scale})`, transformOrigin: "center top" }}
      aria-hidden
    >
      <div className="unit-mini-cabinet-top" />
      <div className="unit-mini-cabinet-body">
        {Array.from({ length: rows }, (_, rowIdx) => {
          const row = rowIdx + 1;
          return (
            <div
              key={row}
              className="unit-mini-cabinet-tier"
              style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
            >
              {Array.from({ length: columns }, (_, colIdx) => {
                const col = colIdx + 1;
                const filled = filledKeys.has(`r${row}c${col}`);
                return <div key={col} className={`unit-mini-cell ${filled ? "unit-mini-cell-filled" : ""}`} />;
              })}
            </div>
          );
        })}
      </div>
      <div className="unit-mini-cabinet-base" />
    </div>
  );
}

function MiniShelfPreview({ rows, filledRows }: { rows: number; filledRows: Set<number> }) {
  const scale = Math.min(1, 56 / (rows * 10));

  return (
    <div
      className="unit-mini unit-mini-shelf unit-mini-scaled"
      style={{ transform: `scale(${scale})`, transformOrigin: "center top" }}
      aria-hidden
    >
      <div className="unit-mini-shelf-upright unit-mini-shelf-upright-left" />
      <div className="unit-mini-shelf-upright unit-mini-shelf-upright-right" />
      <div className="unit-mini-shelf-levels">
        {Array.from({ length: rows }, (_, idx) => {
          const row = rows - idx;
          const filled = filledRows.has(row);
          return (
            <div key={row} className="unit-mini-shelf-level">
              <div className="unit-mini-shelf-board" />
              <div className={`unit-mini-shelf-bay ${filled ? "unit-mini-shelf-bay-filled" : ""}`} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function useLongPress(onLongPress: () => void, delayMs = 480) {
  const timerRef = useRef<number | null>(null);
  const longPressedRef = useRef(false);

  const clear = () => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const start = () => {
    longPressedRef.current = false;
    clear();
    timerRef.current = window.setTimeout(() => {
      longPressedRef.current = true;
      onLongPress();
    }, delayMs);
  };

  const consumeLongPress = () => {
    const was = longPressedRef.current;
    longPressedRef.current = false;
    return was;
  };

  return { start, clear, consumeLongPress };
}

function StorageUnitCard({
  location,
  inventory,
  canInbound,
  onSelect,
  onPreview,
}: {
  location: Location;
  inventory: InventoryItem[];
  canInbound?: boolean;
  onSelect: () => void;
  onPreview: () => void;
}) {
  const stats = locationStats(inventory, location.id);
  const { cells } = buildShelfCells(location, inventory);
  const { rows, columns } = resolveGridSize(location, inventory);
  const isCabinet = columns != null || isCabinetType(location.type);
  const isEmpty = stats.kindCount === 0;

  const longPress = useLongPress(onPreview);

  const filledKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const cell of cells) {
      if (cell.quantity > 0 && cell.column != null) {
        keys.add(`r${cell.row}c${cell.column}`);
      }
    }
    return keys;
  }, [cells]);

  const filledRows = useMemo(() => {
    const set = new Set<number>();
    for (const cell of cells) {
      if (cell.quantity > 0 && cell.column == null) {
        set.add(cell.row);
      }
    }
    return set;
  }, [cells]);

  const emptyLabel = isEmpty ? (canInbound ? "空 · 点击入库" : "空") : `${stats.kindCount} 种 · ${stats.stockQty} 件`;

  return (
    <button
      type="button"
      className={`storage-unit-card${isEmpty ? " storage-unit-card-empty" : ""}`}
      onClick={() => {
        if (longPress.consumeLongPress()) return;
        onSelect();
      }}
      onTouchStart={longPress.start}
      onTouchEnd={longPress.clear}
      onTouchCancel={longPress.clear}
      onMouseDown={longPress.start}
      onMouseUp={longPress.clear}
      onMouseLeave={longPress.clear}
      onContextMenu={(e) => {
        e.preventDefault();
        onPreview();
      }}
    >
      <div className="storage-unit-card-visual">
        {isCabinet && columns != null ? (
          <MiniCabinetPreview rows={rows} columns={columns} filledKeys={filledKeys} />
        ) : (
          <MiniShelfPreview rows={rows} filledRows={filledRows} />
        )}
      </div>
      <div className="storage-unit-card-info">
        <span className="storage-unit-card-name">{location.name}</span>
        <div className="storage-unit-card-footer">
          <span className={`storage-unit-card-meta${isEmpty ? " storage-unit-card-meta-empty" : ""}`}>{emptyLabel}</span>
          <span className="storage-unit-card-type">{location.type}</span>
        </div>
      </div>
    </button>
  );
}

export function StorageUnitPicker({
  locations,
  inventory,
  folderId,
  canInbound,
  onSelect,
  onNavigate,
}: StorageUnitPickerProps) {
  const navigate = useNavigate();
  const [previewLocation, setPreviewLocation] = useState<Location | null>(null);
  const path = useMemo(() => getLocationPath(locations, folderId), [locations, folderId]);
  const children = useMemo(() => getLocationChildren(locations, folderId), [locations, folderId]);

  const previewMaterialNames = useMemo(() => new Map<string, string>(), []);

  const units = useMemo(
    () => children.filter((loc) => isGridCapableLocation(loc) || getLocationChildren(locations, loc.id).length > 0),
    [children, locations],
  );

  return (
    <div className="storage-unit-picker">
      {(folderId || path.length > 0) && (
        <nav className="folder-breadcrumb" aria-label="库位路径">
          <button type="button" className="folder-crumb" onClick={() => onNavigate(null)}>
            全部
          </button>
          {path.map((node, i) => (
            <span key={node.id} className="folder-crumb-wrap">
              <span className="folder-crumb-sep">/</span>
              <button
                type="button"
                className={`folder-crumb ${i === path.length - 1 ? "folder-crumb-active" : ""}`}
                onClick={() => onNavigate(node.id)}
              >
                {node.name}
              </button>
            </span>
          ))}
        </nav>
      )}

      {units.length === 0 ? (
        <p className="folder-empty-hint">当前层级没有货柜或货架</p>
      ) : (
        <div className="storage-unit-grid">
          {units.map((loc) => {
            const hasChildren = getLocationChildren(locations, loc.id).length > 0;
            const gridCapable = isGridCapableLocation(loc);

            if (!gridCapable && hasChildren) {
              return (
                <button
                  key={loc.id}
                  type="button"
                  className="storage-unit-card storage-unit-card-folder"
                  onClick={() => onNavigate(loc.id)}
                >
                  <div className="storage-unit-card-visual">
                    <span className="material-symbols-outlined storage-unit-folder-icon" aria-hidden>
                      warehouse
                    </span>
                  </div>
                  <div className="storage-unit-card-info">
                    <span className="storage-unit-card-name">{loc.name}</span>
                    <div className="storage-unit-card-footer">
                      <span className="storage-unit-card-meta">进入子库位</span>
                      {loc.type && <span className="storage-unit-card-type">{loc.type}</span>}
                    </div>
                  </div>
                </button>
              );
            }

            return (
              <StorageUnitCard
                key={loc.id}
                location={loc}
                inventory={inventory}
                canInbound={canInbound}
                onSelect={() => onSelect(loc)}
                onPreview={() => setPreviewLocation(loc)}
              />
            );
          })}
        </div>
      )}

      <Popup
        visible={previewLocation !== null}
        onMaskClick={() => setPreviewLocation(null)}
        bodyStyle={{ borderTopLeftRadius: 12, borderTopRightRadius: 12, maxHeight: "78vh", overflow: "auto" }}
      >
        {previewLocation && (
          <div className="popup-panel shelf-preview-popup">
            <div className="popup-panel-head">
              <strong>{previewLocation.name}</strong>
              <button type="button" className="popup-close" onClick={() => setPreviewLocation(null)}>
                关闭
              </button>
            </div>
            <p className="shelf-preview-popup-hint">长按预览 · 点击格子查看详情</p>
            <LocationShelfGrid
              location={previewLocation}
              inventory={inventory}
              materialNames={previewMaterialNames}
              onCellClick={(cell) => {
                setPreviewLocation(null);
                const params = new URLSearchParams();
                if (cell.row > 0) params.set("row", String(cell.row));
                if (cell.column != null) params.set("column", String(cell.column));
                const qs = params.toString();
                navigate(`/shelves/${previewLocation.id}${qs ? `?${qs}` : ""}`);
              }}
            />
            <button
              type="button"
              className="shelf-preview-open-full"
              onClick={() => {
                setPreviewLocation(null);
                onSelect(previewLocation);
              }}
            >
              打开完整格位图
            </button>
          </div>
        )}
      </Popup>
    </div>
  );
}
