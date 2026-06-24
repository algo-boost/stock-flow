import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { InventoryItem, Location } from "../api/types";
import { buildShelfCells, resolveGridSize } from "../utils/shelfGrid";

interface LocationShelfGridProps {
  location: Location;
  inventory: InventoryItem[];
  materialNames: Map<string, string>;
  onCellClick: (cell: { row: number; column: number | null; items: InventoryItem[]; label: string; previewOnly?: boolean }) => void;
}

type ShelfCell = ReturnType<typeof buildShelfCells>["cells"][number];

function isCabinetType(type: string): boolean {
  return type.includes("柜");
}

function touchDistance(touches: TouchList) {
  if (touches.length < 2) return 0;
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

function CabinetGrid({
  location,
  cells,
  columns,
  rows,
  zoom,
  focusedRow,
  onTierFocus,
  onCellClick,
}: {
  location: Location;
  cells: ShelfCell[];
  columns: number;
  rows: number;
  zoom: number;
  focusedRow: number | null;
  onTierFocus: (row: number | null) => void;
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

  const visibleRows = focusedRow != null ? rowsGrouped.filter(([row]) => row === focusedRow) : rowsGrouped;

  return (
    <div className="storage-unit storage-cabinet">
      <div className="storage-cabinet-header">
        <span className="storage-cabinet-title">{location.name}</span>
        <span className="storage-cabinet-spec">{rows} 层 × {columns} 列</span>
      </div>
      <div
        className="shelf-grid-zoom-inner"
        style={{ transform: `scale(${zoom})`, transformOrigin: "top center" }}
      >
        <div className="storage-cabinet-body">
          <div className="storage-cabinet-side storage-cabinet-side-left" />
          <div className="storage-cabinet-inner">
            {visibleRows.map(([row, rowCells]) => (
              <div key={row} className="storage-cabinet-tier">
                <button
                  type="button"
                  className={`storage-tier-label storage-tier-label-btn${focusedRow === row ? " storage-tier-label-active" : ""}`}
                  onClick={() => onTierFocus(focusedRow === row ? null : row)}
                  title="点层号可单独展开"
                >
                  第{row}层↑
                </button>
                <div
                  className="storage-cabinet-drawers"
                  style={{ gridTemplateColumns: `repeat(${columns}, minmax(44px, 1fr))` }}
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
      </div>
      <div className="storage-cabinet-plinth" />
    </div>
  );
}

function RackGrid({
  location,
  cells,
  rows,
  zoom,
  focusedRow,
  onTierFocus,
  materialNames,
  onCellClick,
}: {
  location: Location;
  cells: ShelfCell[];
  rows: number;
  zoom: number;
  focusedRow: number | null;
  onTierFocus: (row: number | null) => void;
  materialNames: Map<string, string>;
  onCellClick: LocationShelfGridProps["onCellClick"];
}) {
  const sortedCells = useMemo(
    () => [...cells].sort((a, b) => b.row - a.row),
    [cells],
  );

  const visibleCells =
    focusedRow != null ? sortedCells.filter((cell) => cell.row === focusedRow) : sortedCells;

  return (
    <div className="storage-unit storage-rack">
      <div className="storage-rack-header">
        <span className="storage-rack-title">{location.name}</span>
        <span className="storage-rack-spec">{rows} 层</span>
      </div>
      <div
        className="shelf-grid-zoom-inner"
        style={{ transform: `scale(${zoom})`, transformOrigin: "top center" }}
      >
        <div className="storage-rack-frame">
          <div className="storage-rack-upright storage-rack-upright-left" />
          <div className="storage-rack-upright storage-rack-upright-right" />
          <div className="storage-rack-levels">
            {visibleCells.map((cell) => (
              <div key={cell.key} className="storage-rack-level">
                <div className="storage-rack-board" />
                <div className={`storage-rack-bay ${cell.quantity > 0 ? "storage-rack-bay-filled" : ""}`}>
                  <button
                    type="button"
                    className={`storage-rack-label storage-tier-label-btn${focusedRow === cell.row ? " storage-tier-label-active" : ""}`}
                    onClick={() => onTierFocus(focusedRow === cell.row ? null : cell.row)}
                  >
                    {cell.label}
                  </button>
                  <button type="button" className="storage-rack-bay-hit" onClick={() => onCellClick(cell)}>
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
              </div>
            ))}
          </div>
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
  const wrapRef = useRef<HTMLDivElement>(null);
  const pinchRef = useRef({ startDist: 0, startZoom: 1 });
  const [zoom, setZoom] = useState(1);
  const [focusedRow, setFocusedRow] = useState<number | null>(null);

  const { cells, unslotted, previewDistributed } = useMemo(
    () => buildShelfCells(location, inventory),
    [location, inventory],
  );
  const { rows, columns } = useMemo(() => resolveGridSize(location, inventory), [location, inventory]);
  const showCabinet = columns != null || isCabinetType(location.type);

  const clampZoom = useCallback((value: number) => Math.min(2, Math.max(0.75, value)), []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        pinchRef.current = { startDist: touchDistance(e.touches), startZoom: zoom };
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || pinchRef.current.startDist <= 0) return;
      e.preventDefault();
      const dist = touchDistance(e.touches);
      const ratio = dist / pinchRef.current.startDist;
      setZoom(clampZoom(pinchRef.current.startZoom * ratio));
    };

    const onTouchEnd = () => {
      pinchRef.current.startDist = 0;
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [clampZoom, zoom]);

  return (
    <div className="shelf-grid-wrap" ref={wrapRef}>
      <div className="shelf-grid-toolbar">
        <button type="button" className="shelf-grid-tool-btn" onClick={() => setZoom((z) => clampZoom(z - 0.15))} aria-label="缩小">
          －
        </button>
        <span className="shelf-grid-zoom-label">{Math.round(zoom * 100)}%</span>
        <button type="button" className="shelf-grid-tool-btn" onClick={() => setZoom((z) => clampZoom(z + 0.15))} aria-label="放大">
          ＋
        </button>
        {focusedRow != null && (
          <button type="button" className="shelf-grid-tool-link" onClick={() => setFocusedRow(null)}>
            显示全部层
          </button>
        )}
        <span className="shelf-grid-tool-hint">双指缩放 · 点层号单层展开</span>
      </div>

      {previewDistributed && (
        <p className="shelf-preview-hint">
          部分物料尚未标注格位，下图仅为示意分布；入库时请指定真实格位。层号自下而上编号。
        </p>
      )}

      {showCabinet && columns != null ? (
        <CabinetGrid
          location={location}
          cells={cells}
          columns={columns}
          rows={rows}
          zoom={zoom}
          focusedRow={focusedRow}
          onTierFocus={setFocusedRow}
          onCellClick={onCellClick}
        />
      ) : (
        <RackGrid
          location={location}
          cells={cells}
          rows={rows}
          zoom={zoom}
          focusedRow={focusedRow}
          onTierFocus={setFocusedRow}
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
