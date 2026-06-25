import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { InventoryItem, Location } from "../api/types";
import { buildShelfCells, cellHasMaterial, cellMaterialQty, resolveGridSize } from "../utils/shelfGrid";
import { isSlotSelected, type SlotSelection } from "../utils/inventorySlot";
import { ShelfGridLegend, type ShelfGridLegendMode } from "./ShelfGridLegend";

interface LocationShelfGridProps {
  location: Location;
  inventory: InventoryItem[];
  materialNames: Map<string, string>;
  onCellClick: (cell: { row: number; column: number | null; items: InventoryItem[]; label: string; previewOnly?: boolean }) => void;
  pickMode?: boolean;
  outboundPickMode?: boolean;
  selectedSlot?: SlotSelection | null;
  compact?: boolean;
  highlightMaterialId?: string;
  showLegend?: boolean;
  legendMode?: ShelfGridLegendMode;
  /** 物料详情页：突出本物料格位、弱化其他格 */
  detailViewMode?: boolean;
  /** 详情页已展示库位名，隐藏格位图内重复标题 */
  hideHeader?: boolean;
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

function drawerClassNames(
  cell: ShelfCell,
  selectedSlot: SlotSelection | null | undefined,
  highlightMaterialId?: string,
  detailViewMode?: boolean,
): string {
  const targetQty = cellMaterialQty(cell, highlightMaterialId);
  const hasOther = cell.quantity > 0 && !targetQty;
  const parts = ["storage-drawer"];
  if (detailViewMode && highlightMaterialId) {
    if (targetQty > 0) parts.push("storage-drawer-detail-active");
    else if (hasOther || cell.quantity > 0) parts.push("storage-drawer-detail-muted");
    return parts.join(" ");
  }
  const selected = isSlotSelected(cell, selectedSlot);
  if (selected) parts.push("storage-drawer-selected");
  else if (targetQty > 0) parts.push("storage-drawer-has-target");
  else if (hasOther || cell.quantity > 0) parts.push("storage-drawer-filled");
  return parts.join(" ");
}

function rackBayClassNames(
  cell: ShelfCell,
  selectedSlot: SlotSelection | null | undefined,
  highlightMaterialId?: string,
  detailViewMode?: boolean,
): string {
  const targetQty = cellMaterialQty(cell, highlightMaterialId);
  const hasOther = cell.quantity > 0 && !targetQty;
  const parts = ["storage-rack-bay"];
  if (detailViewMode && highlightMaterialId) {
    if (targetQty > 0) parts.push("storage-rack-bay-detail-active");
    else if (hasOther || cell.quantity > 0) parts.push("storage-rack-bay-detail-muted");
    return parts.join(" ");
  }
  const selected = isSlotSelected(cell, selectedSlot);
  if (selected) parts.push("storage-rack-bay-selected");
  else if (targetQty > 0) parts.push("storage-rack-bay-has-target");
  else if (hasOther || cell.quantity > 0) parts.push("storage-rack-bay-filled");
  return parts.join(" ");
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
  selectedSlot,
  highlightMaterialId,
  outboundPickMode,
  detailViewMode,
  hideHeader,
}: {
  location: Location;
  cells: ShelfCell[];
  columns: number;
  rows: number;
  zoom: number;
  focusedRow: number | null;
  onTierFocus: (row: number | null) => void;
  onCellClick: LocationShelfGridProps["onCellClick"];
  selectedSlot?: SlotSelection | null;
  highlightMaterialId?: string;
  outboundPickMode?: boolean;
  detailViewMode?: boolean;
  hideHeader?: boolean;
}) {
  const rowsGrouped = useMemo(() => {
    const map = new Map<number, ShelfCell[]>();
    for (const cell of cells) {
      const list = map.get(cell.row) ?? [];
      list.push(cell);
      map.set(cell.row, list);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => b - a)
      .map(([row, rowCells]) => [row, [...rowCells].sort((a, b) => (a.column ?? 0) - (b.column ?? 0))] as const);
  }, [cells]);

  const visibleRows = focusedRow != null ? rowsGrouped.filter(([row]) => row === focusedRow) : rowsGrouped;
  const columnLabels = useMemo(
    () => Array.from({ length: columns }, (_, index) => index + 1),
    [columns],
  );

  const handleCellClick = (cell: ShelfCell) => {
    if (outboundPickMode && !cellHasMaterial(cell, highlightMaterialId)) return;
    onCellClick(cell);
  };

  return (
    <div className="storage-unit storage-cabinet">
      {!hideHeader && (
        <div className="storage-cabinet-header">
          <span className="storage-cabinet-title">{location.name}</span>
          <span className="storage-cabinet-spec">{rows} 层 × {columns} 列</span>
        </div>
      )}
      <div
        className="shelf-grid-zoom-inner"
        style={{ transform: `scale(${zoom})`, transformOrigin: "top center" }}
      >
        <div className="storage-cabinet-body">
          <div className="storage-cabinet-side storage-cabinet-side-left" />
          <div className="storage-cabinet-inner">
            {focusedRow == null && (
              <div
                className="storage-cabinet-col-header"
                style={{ gridTemplateColumns: `52px repeat(${columns}, minmax(44px, 1fr))` }}
              >
                <span className="storage-tier-label-spacer">层＼列</span>
                {columnLabels.map((col) => (
                  <span key={col} className="storage-col-label">
                    第{col}列
                  </span>
                ))}
              </div>
            )}
            {visibleRows.map(([row, rowCells]) => (
              <div key={row} className="storage-cabinet-tier">
                <button
                  type="button"
                  className={`storage-tier-label storage-tier-label-btn${focusedRow === row ? " storage-tier-label-active" : ""}`}
                  onClick={() => onTierFocus(focusedRow === row ? null : row)}
                  title="点层号可单独展开"
                >
                  第{row}层
                </button>
                <div
                  className="storage-cabinet-drawers"
                  style={{ gridTemplateColumns: `repeat(${columns}, minmax(44px, 1fr))` }}
                >
                  {rowCells.map((cell) => {
                    const targetQty = cellMaterialQty(cell, highlightMaterialId);
                    const clickable = !outboundPickMode || targetQty > 0;
                    return (
                      <button
                        key={cell.key}
                        type="button"
                        className={drawerClassNames(cell, selectedSlot, highlightMaterialId, detailViewMode)}
                        disabled={!clickable}
                        onClick={() => handleCellClick(cell)}
                      >
                        <div className="storage-drawer-face">
                          <div className="storage-drawer-handle" />
                          <span className="storage-drawer-pos">{cell.column}</span>
                          {targetQty > 0 ? (
                            <>
                              <span className={`storage-drawer-qty${detailViewMode ? "" : " storage-drawer-qty-target"}`}>{targetQty}</span>
                              {cell.items.length > 1 && cell.quantity > targetQty && (
                                <span className="storage-drawer-kinds">混</span>
                              )}
                            </>
                          ) : cell.quantity > 0 ? (
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
                    );
                  })}
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
  selectedSlot,
  highlightMaterialId,
  outboundPickMode,
  detailViewMode,
  hideHeader,
}: {
  location: Location;
  cells: ShelfCell[];
  rows: number;
  zoom: number;
  focusedRow: number | null;
  onTierFocus: (row: number | null) => void;
  materialNames: Map<string, string>;
  onCellClick: LocationShelfGridProps["onCellClick"];
  selectedSlot?: SlotSelection | null;
  highlightMaterialId?: string;
  outboundPickMode?: boolean;
  detailViewMode?: boolean;
  hideHeader?: boolean;
}) {
  const sortedCells = useMemo(
    () => [...cells].sort((a, b) => b.row - a.row),
    [cells],
  );

  const visibleCells =
    focusedRow != null ? sortedCells.filter((cell) => cell.row === focusedRow) : sortedCells;

  const handleCellClick = (cell: ShelfCell) => {
    if (outboundPickMode && !cellHasMaterial(cell, highlightMaterialId)) return;
    onCellClick(cell);
  };

  return (
    <div className="storage-unit storage-rack">
      {!hideHeader && (
        <div className="storage-rack-header">
          <span className="storage-rack-title">{location.name}</span>
          <span className="storage-rack-spec">{rows} 层 · 自下而上编号</span>
        </div>
      )}
      <div
        className="shelf-grid-zoom-inner"
        style={{ transform: `scale(${zoom})`, transformOrigin: "top center" }}
      >
        <div className="storage-rack-frame">
          <div className="storage-rack-upright storage-rack-upright-left" />
          <div className="storage-rack-upright storage-rack-upright-right" />
          <div className="storage-rack-levels">
            {visibleCells.map((cell) => {
              const targetQty = cellMaterialQty(cell, highlightMaterialId);
              const clickable = !outboundPickMode || targetQty > 0;
              return (
                <div key={cell.key} className="storage-rack-level">
                  <div className="storage-rack-board" />
                  <div className={rackBayClassNames(cell, selectedSlot, highlightMaterialId, detailViewMode)}>
                    <button
                      type="button"
                      className={`storage-rack-label storage-tier-label-btn${focusedRow === cell.row ? " storage-tier-label-active" : ""}`}
                      onClick={() => onTierFocus(focusedRow === cell.row ? null : cell.row)}
                    >
                      {cell.label}
                    </button>
                    <button
                      type="button"
                      className="storage-rack-bay-hit"
                      disabled={!clickable}
                      onClick={() => handleCellClick(cell)}
                    >
                      {targetQty > 0 ? (
                        <div className="storage-rack-contents">
                          <span className="storage-rack-qty storage-rack-qty-target">{targetQty} 件</span>
                          {cell.items.length > 1 && cell.quantity > targetQty && (
                            <span className="storage-rack-kinds">含其他物料</span>
                          )}
                        </div>
                      ) : cell.quantity > 0 ? (
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
              );
            })}
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

export function LocationShelfGrid({
  location,
  inventory,
  materialNames,
  onCellClick,
  pickMode = false,
  outboundPickMode = false,
  selectedSlot,
  compact = false,
  highlightMaterialId,
  showLegend = false,
  legendMode = "view",
  detailViewMode = false,
  hideHeader = false,
}: LocationShelfGridProps) {
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
  const resolvedLegendMode: ShelfGridLegendMode = detailViewMode
    ? "detail"
    : legendMode !== "view"
      ? legendMode
      : pickMode
        ? "inbound"
        : outboundPickMode
          ? "outbound"
          : "view";

  const showUnslotted = unslotted.length > 0 && !detailViewMode;

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
    <div
      className={`shelf-grid-wrap${compact ? " shelf-grid-wrap-compact" : ""}${detailViewMode ? " shelf-grid-wrap-detail" : ""}`}
      ref={wrapRef}
    >
      {!detailViewMode && (
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
        {!compact && <span className="shelf-grid-tool-hint">双指缩放 · 点层号单层展开</span>}
        {pickMode && compact && <span className="shelf-grid-tool-hint">点格选中入库位置</span>}
        {outboundPickMode && compact && <span className="shelf-grid-tool-hint">点选有本物料的格位出库</span>}
      </div>
      )}

      {detailViewMode && (
        <div className="shelf-grid-toolbar shelf-grid-toolbar-minimal">
          <span className="shelf-grid-tool-hint">层自下而上 · 高亮格为本物料</span>
          <div className="shelf-grid-toolbar-zoom">
            <button type="button" className="shelf-grid-tool-btn" onClick={() => setZoom((z) => clampZoom(z - 0.15))} aria-label="缩小">－</button>
            <span className="shelf-grid-zoom-label">{Math.round(zoom * 100)}%</span>
            <button type="button" className="shelf-grid-tool-btn" onClick={() => setZoom((z) => clampZoom(z + 0.15))} aria-label="放大">＋</button>
          </div>
        </div>
      )}

      {!pickMode && !outboundPickMode && previewDistributed && !detailViewMode && (
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
          selectedSlot={selectedSlot}
          highlightMaterialId={highlightMaterialId}
          outboundPickMode={outboundPickMode}
          detailViewMode={detailViewMode}
          hideHeader={hideHeader}
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
          selectedSlot={selectedSlot}
          highlightMaterialId={highlightMaterialId}
          outboundPickMode={outboundPickMode}
          detailViewMode={detailViewMode}
          hideHeader={hideHeader}
        />
      )}

      {!pickMode && !outboundPickMode && showUnslotted && (
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

      {(showLegend || pickMode || outboundPickMode) && (
        <ShelfGridLegend mode={resolvedLegendMode} />
      )}
    </div>
  );
}
