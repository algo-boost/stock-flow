import { useMemo, type ReactNode } from "react";

export interface ChartSegment {
  label: string;
  value: number;
  color: string;
}

export const CHART_PALETTE = [
  "#3370ff",
  "#00b873",
  "#ff7d00",
  "#f53f3f",
  "#722ed1",
  "#13c2c2",
  "#eb2f96",
  "#86909c",
];

export function buildSegments(
  rows: Array<{ label: string; value: number }>,
  maxItems = 5,
): ChartSegment[] {
  const sorted = [...rows].filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
  if (sorted.length === 0) return [];

  const top = sorted.slice(0, maxItems);
  const rest = sorted.slice(maxItems);
  const segments: ChartSegment[] = top.map((row, i) => ({
    label: row.label,
    value: row.value,
    color: CHART_PALETTE[i % CHART_PALETTE.length],
  }));
  if (rest.length > 0) {
    segments.push({
      label: "其他",
      value: rest.reduce((sum, row) => sum + row.value, 0),
      color: CHART_PALETTE[maxItems % CHART_PALETTE.length],
    });
  }
  return segments;
}

function conicGradient(segments: ChartSegment[]): string {
  const total = segments.reduce((sum, seg) => sum + seg.value, 0) || 1;
  let acc = 0;
  const stops: string[] = [];
  for (const seg of segments) {
    const start = (acc / total) * 100;
    acc += seg.value;
    const end = (acc / total) * 100;
    stops.push(`${seg.color} ${start.toFixed(2)}% ${end.toFixed(2)}%`);
  }
  return `conic-gradient(from -90deg, ${stops.join(", ")})`;
}

interface DonutChartProps {
  segments: ChartSegment[];
  centerTop?: string;
  centerBottom?: string;
  size?: number;
}

export function DonutChart({ segments, centerTop, centerBottom, size = 76 }: DonutChartProps) {
  const total = segments.reduce((sum, seg) => sum + seg.value, 0);
  if (total <= 0) {
    return <div className="chart-empty">暂无数据</div>;
  }

  return (
    <div className="chart-donut-wrap" style={{ width: size, height: size }}>
      <div
        className="chart-donut-ring"
        style={{ background: conicGradient(segments), width: size, height: size }}
        aria-hidden
      />
      <div className="chart-donut-hole">
        {centerTop && <strong>{centerTop}</strong>}
        {centerBottom && <span>{centerBottom}</span>}
      </div>
    </div>
  );
}

interface ChartLegendProps {
  segments: ChartSegment[];
  unit?: string;
  compact?: boolean;
}

export function ChartLegend({ segments, unit = "", compact = false }: ChartLegendProps) {
  const total = segments.reduce((sum, seg) => sum + seg.value, 0) || 1;
  return (
    <ul className={`chart-legend ${compact ? "chart-legend-compact" : ""}`}>
      {segments.map((seg) => (
        <li key={seg.label} className="chart-legend-item">
          <span className="chart-legend-dot" style={{ background: seg.color }} />
          <span className="chart-legend-label">{seg.label}</span>
          <span className="chart-legend-val">
            {seg.value}
            {unit}
            <em>{Math.round((seg.value / total) * 100)}%</em>
          </span>
        </li>
      ))}
    </ul>
  );
}

export interface BarRow {
  label: string;
  value: number;
  color?: string;
  hint?: string;
}

interface HorizontalBarChartProps {
  rows: BarRow[];
  unit?: string;
  maxRows?: number;
}

export function HorizontalBarChart({ rows, unit = "", maxRows = 6 }: HorizontalBarChartProps) {
  const visible = rows.filter((r) => r.value > 0).slice(0, maxRows);
  const maxVal = Math.max(1, ...visible.map((r) => r.value));

  if (visible.length === 0) {
    return <div className="chart-empty">暂无数据</div>;
  }

  return (
    <div className="chart-bars">
      {visible.map((row, i) => (
        <div key={row.label} className="chart-bar-row">
          <span className="chart-bar-label" title={row.label}>
            {row.label}
          </span>
          <div className="chart-bar-track">
            <div
              className="chart-bar-fill"
              style={{
                width: `${(row.value / maxVal) * 100}%`,
                background: row.color ?? CHART_PALETTE[i % CHART_PALETTE.length],
              }}
            />
          </div>
          <span className="chart-bar-val">
            {row.value}
            {unit}
          </span>
        </div>
      ))}
    </div>
  );
}

interface ChartPanelProps {
  title: string;
  children: ReactNode;
  wide?: boolean;
}

export function ChartPanel({ title, children, wide }: ChartPanelProps) {
  return (
    <div className={`chart-panel ${wide ? "chart-panel-wide" : ""}`}>
      <div className="chart-panel-title">{title}</div>
      {children}
    </div>
  );
}

export function useCategoryChartSegments(
  rows: Array<{ category_name?: string; stock_qty: number }> | undefined,
) {
  return useMemo(
    () =>
      buildSegments(
        (rows ?? []).map((row) => ({
          label: row.category_name ?? "未分类",
          value: row.stock_qty,
        })),
      ),
    [rows],
  );
}

export function useLocationChartSegments(
  rows: Array<{ location_name?: string; stock_qty: number }> | undefined,
) {
  return useMemo(
    () =>
      buildSegments(
        (rows ?? []).map((row) => ({
          label: row.location_name ?? "未知库位",
          value: row.stock_qty,
        })),
        6,
      ),
    [rows],
  );
}
