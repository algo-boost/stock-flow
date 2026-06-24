import { useMemo } from "react";
import type { InventoryItem, Location } from "../api/types";
import { buildShelfCells, resolveGridSize } from "../utils/shelfGrid";

interface LocationShelfGridProps {
  location: Location;
  inventory: InventoryItem[];
  materialNames: Map<string, string>;
  onCellClick: (cell: { row: number; column: number | null; items: InventoryItem[]; label: string }) => void;
}

type ShelfCell = ReturnType<typeof buildShelfCells>["cells"][number];

function isCabinetType(type: string): boolean {
  return type.includes("柜");
}

function CabinetGrid({
  location,
  cells,
  columns,
  rows,
  onCellClick,
}: {
  location: Location;
  cells: ShelfCell[];
  columns: number;
  rows: number;
  onCellClick: LocationShelfGridProps["onCellClick"];
}) {
  const rowsGrouped = useMemo(() => {
    const map = new Map<number, ShelfCell[]>();
    for (const cell of cells) {
      const list = map.get(cell.row) ?? [];
      list.push(cell);
      map.set(cell.row, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a - b);
  }, [cells]);

  return (
    <div className="storage-unit storage-cabinet">
      <div className="storage-cabinet-header">
        <span className="storage-cabinet-title">{location.name}</span>
        <span className="storage-cabinet-spec">{rows} 层 × {columns} 列</span>
      </div>
      <div className="storage-cabinet-body">
        <div className="storage-cabinet-side storage-cabinet-side-left" />
        <div className="storage-cabinet-inner">
          {rowsGrouped.map(([row, rowCells]) => (
            <div key={row} className="storage-cabinet-tier">
              <span className="storage-tier-label">{row}F</span>
              <div
                className="storage-cabinet-drawers"
                style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
              >
                {rowCells.map((cell) => (
                  <button
                    key={cell.key}
                    type="button"
                    className={`storage-drawer ${cell.quantity > 0 ? "storage-drawer-filled" : ""}`}
                    onClick={() => onCellClick(cell)}
                  >
                    <div className="storage-drawer-face">
                      <div className="storage-drawer-handle" />
                      <span className="storage-drawer-pos">{cell.column}</span>
                      {cell.quantity > 0 ? (
                        <>
                          <span className="storage-drawer-qty">{cell.quantity}</span>
                          {cell.items.length > 1 && (
                            <span className="storage-drawer-kinds">{cell.items.length}种</span>
                          )}
                        </>
                      ) : (
                        <span className="storage-drawer-empty">空</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="storage-cabinet-side storage-cabinet-side-right" />
      </div>
      <div className="storage-cabinet-plinth" />
    </div>
  );
}

function RackGrid({
  location,
  cells,
  rows,
  materialNames,
  onCellClick,
}: {
  location: Location;
  cells: ShelfCell[];
  rows: number;
  materialNames: Map<string, string>;
  onCellClick: LocationShelfGridProps["onCellClick"];
}) {
  const sortedCells = useMemo(
    () => [...cells].sort((a, b) => b.row - a.row),
    [cells],
  );

  return (
    <div className="storage-unit storage-rack">
      <div className="storage-rack-header">
        <span className="storage-rack-title">{location.name}</span>
        <span className="storage-rack-spec">{rows} 层</span>
      </div>
      <div className="storage-rack-frame">
        <div className="storage-rack-upright storage-rack-upright-left" />
        <div className="storage-rack-upright storage-rack-upright-right" />
        <div className="storage-rack-levels">
          {sortedCells.map((cell) => (
            <div key={cell.key} className="storage-rack-level">
              <div className="storage-rack-board" />
              <button
                type="button"
                className={`storage-rack-bay ${cell.quantity > 0 ? "storage-rack-bay-filled" : ""}`}
                onClick={() => onCellClick(cell)}
              >
                <span className="storage-rack-label">{cell.label}</span>
                {cell.quantity > 0 ? (
                  <div className="storage-rack-contents">
                    <span className="storage-rack-qty">{cell.quantity} 件</span>
                    {cell.items.length > 1 && (
                      <span className="storage-rack-kinds">{cell.items.length} 种物料</span>
                    )}
                    <div className="storage-rack-boxes">
                      {cell.items.slice(0, 4).map((item) => (
                        <span
                          key={item.material_id}
                          className="storage-rack-box"
                          title={materialNames.get(item.material_id)}
                        >
                          ▪
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <span className="storage-rack-empty">空置</span>
                )}
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className="storage-rack-feet">
        <span />
        <span />
      </div>
    </div>
  );
}

export function LocationShelfGrid({ location, inventory, materialNames, onCellClick }: LocationShelfGridProps) {
  const { cells, unslotted, previewDistributed } = useMemo(
    () => buildShelfCells(location, inventory),
    [location, inventory],
  );
  const { rows, columns } = useMemo(() => resolveGridSize(location, inventory), [location, inventory]);
  const showCabinet = columns != null || isCabinetType(location.type);

  return (
    <div className="shelf-grid-wrap">
      {previewDistributed && (
        <p className="shelf-preview-hint">格位为预览分布（库存尚未指定行列），入库时可指定真实格位</p>
      )}

      {showCabinet && columns != null ? (
        <CabinetGrid
          location={location}
          cells={cells}
          columns={columns}
          rows={rows}
          onCellClick={onCellClick}
        />
      ) : (
        <RackGrid
          location={location}
          cells={cells}
          rows={rows}
          materialNames={materialNames}
          onCellClick={onCellClick}
        />
      )}

      {unslotted.length > 0 && (
        <div className="shelf-unslotted">
          <div className="shelf-unslotted-title">未指定格位</div>
          <button
            type="button"
            className="shelf-unslotted-bar"
            onClick={() =>
              onCellClick({
                row: 0,
                column: null,
                label: "未指定格位",
                items: unslotted,
              })
            }
          >
            <span>{unslotted.length} 条记录 · 共 {unslotted.reduce((sum, item) => sum + item.quantity, 0)} 件</span>
            <span className="shelf-unslotted-action">查看</span>
          </button>
        </div>
      )}
    </div>
  );
}
