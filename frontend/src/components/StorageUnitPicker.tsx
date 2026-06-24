import { useMemo } from "react";
import type { InventoryItem, Location } from "../api/types";
import { getLocationChildren, getLocationPath } from "../utils/locationTree";
import { buildShelfCells, isGridCapableLocation, resolveGridSize } from "../utils/shelfGrid";

interface StorageUnitPickerProps {
  locations: Location[];
  inventory: InventoryItem[];
  folderId: string | null;
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
  const displayRows = Math.min(rows, 4);
  const displayCols = Math.min(columns, 6);

  return (
    <div className="unit-mini unit-mini-cabinet" aria-hidden>
      <div className="unit-mini-cabinet-top" />
      <div className="unit-mini-cabinet-body">
        {Array.from({ length: displayRows }, (_, rowIdx) => {
          const row = rowIdx + 1;
          return (
            <div
              key={row}
              className="unit-mini-cabinet-tier"
              style={{ gridTemplateColumns: `repeat(${displayCols}, 1fr)` }}
            >
              {Array.from({ length: displayCols }, (_, colIdx) => {
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
  const displayRows = Math.min(rows, 5);

  return (
    <div className="unit-mini unit-mini-shelf" aria-hidden>
      <div className="unit-mini-shelf-upright unit-mini-shelf-upright-left" />
      <div className="unit-mini-shelf-upright unit-mini-shelf-upright-right" />
      <div className="unit-mini-shelf-levels">
        {Array.from({ length: displayRows }, (_, idx) => {
          const row = displayRows - idx;
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

function StorageUnitCard({
  location,
  inventory,
  onSelect,
}: {
  location: Location;
  inventory: InventoryItem[];
  onSelect: () => void;
}) {
  const stats = locationStats(inventory, location.id);
  const { cells } = buildShelfCells(location, inventory);
  const { rows, columns } = resolveGridSize(location, inventory);
  const isCabinet = columns != null || isCabinetType(location.type);

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

  return (
    <button type="button" className="storage-unit-card" onClick={onSelect}>
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
          <span className="storage-unit-card-meta">
            {stats.kindCount > 0 ? `${stats.kindCount} 种 · ${stats.stockQty} 件` : "空"}
          </span>
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
  onSelect,
  onNavigate,
}: StorageUnitPickerProps) {
  const path = useMemo(() => getLocationPath(locations, folderId), [locations, folderId]);
  const children = useMemo(() => getLocationChildren(locations, folderId), [locations, folderId]);

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
                onSelect={() => onSelect(loc)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
