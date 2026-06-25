export type ShelfGridLegendMode = "inbound" | "outbound" | "view" | "detail";

interface ShelfGridLegendProps {
  mode: ShelfGridLegendMode;
  showSelected?: boolean;
}

const LEGEND_ITEMS: Record<ShelfGridLegendMode, Array<{ className: string; label: string }>> = {
  inbound: [
    { className: "shelf-legend-swatch shelf-legend-empty", label: "空格" },
    { className: "shelf-legend-swatch shelf-legend-other", label: "已有其他物料" },
    { className: "shelf-legend-swatch shelf-legend-target", label: "已有本物料" },
    { className: "shelf-legend-swatch shelf-legend-selected", label: "已选中" },
  ],
  outbound: [
    { className: "shelf-legend-swatch shelf-legend-empty", label: "无本物料" },
    { className: "shelf-legend-swatch shelf-legend-target", label: "有本物料（可出库）" },
    { className: "shelf-legend-swatch shelf-legend-selected", label: "已选中" },
  ],
  view: [
    { className: "shelf-legend-swatch shelf-legend-empty", label: "空" },
    { className: "shelf-legend-swatch shelf-legend-other", label: "有库存" },
  ],
  detail: [
    { className: "shelf-legend-swatch shelf-legend-empty", label: "空" },
    { className: "shelf-legend-swatch shelf-legend-other", label: "其他物料" },
    { className: "shelf-legend-swatch shelf-legend-target", label: "本物料在此" },
  ],
};

export function ShelfGridLegend({ mode, showSelected = true }: ShelfGridLegendProps) {
  const items = LEGEND_ITEMS[mode].filter(
    (item) => showSelected || !item.className.includes("selected"),
  );

  return (
    <div className="shelf-grid-legend" aria-label="格位图图例">
      {items.map((item) => (
        <span className="shelf-legend-item" key={item.label}>
          <span className={item.className} aria-hidden />
          {item.label}
        </span>
      ))}
      {mode !== "view" && mode !== "detail" && (
        <span className="shelf-legend-note">层号自下而上，第 1 层在最下方</span>
      )}
      {mode === "detail" && (
        <span className="shelf-legend-note">琥珀色格即本物料位置</span>
      )}
    </div>
  );
}
