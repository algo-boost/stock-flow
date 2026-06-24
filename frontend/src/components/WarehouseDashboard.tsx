import { useMemo } from "react";
import { Button } from "antd-mobile";
import { useNavigate } from "react-router-dom";
import type { AdminOverview } from "../api/types";
import { formatIsoDate, resolveDateRange } from "../utils/historyDisplay";
import {
  BarRow,
  ChartLegend,
  ChartPanel,
  DonutChart,
  HorizontalBarChart,
  useCategoryChartSegments,
  useLocationChartSegments,
} from "./charts/MiniCharts";
import { EmptyState, SectionCard, TxBadge } from "./ui";

export type DashboardPeriod = "today" | "7d" | "30d" | "all";

const PERIOD_OPTIONS: Array<{ label: string; value: DashboardPeriod }> = [
  { label: "今天", value: "today" },
  { label: "近7天", value: "7d" },
  { label: "近30天", value: "30d" },
  { label: "全部", value: "all" },
];

export function resolveDashboardPeriod(period: DashboardPeriod): { startAt?: string; endAt?: string } {
  if (period === "all") return {};
  if (period === "today") {
    const day = formatIsoDate(new Date());
    return { startAt: `${day}T00:00:00`, endAt: `${day}T23:59:59` };
  }
  return resolveDateRange(period, "", "");
}

function periodActivityLabel(period: DashboardPeriod): string {
  if (period === "today") return "今日";
  if (period === "7d") return "近7天";
  if (period === "30d") return "近30天";
  return "全部";
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

interface WarehouseDashboardProps {
  overview: AdminOverview;
  period: DashboardPeriod;
  loading: boolean;
  onPeriodChange: (period: DashboardPeriod) => void;
  onRefresh: () => void;
}

export function WarehouseDashboard({
  overview,
  period,
  loading,
  onPeriodChange,
  onRefresh,
}: WarehouseDashboardProps) {
  const navigate = useNavigate();
  const totals = overview.totals;
  const activityLabel = periodActivityLabel(period);
  const pendingItems = overview.pending_requests_list ?? [];
  const lowStockItems = overview.low_stock_items ?? [];
  const actionCount = (totals.pending_requests ?? 0) + (totals.low_stock_count ?? 0);

  const stockStructure = useMemo(() => {
    const low = totals.low_stock_count ?? 0;
    const inStock = totals.in_stock_count ?? 0;
    const zero = totals.zero_stock_count ?? 0;
    const normal = Math.max(0, inStock - low);
    return [
      { label: "库存正常", value: normal, color: "#00b873" },
      { label: "低库存", value: low, color: "#ff7d00" },
      { label: "零库存", value: zero, color: "#c9cdd4" },
    ].filter((seg) => seg.value > 0);
  }, [totals.in_stock_count, totals.low_stock_count, totals.zero_stock_count]);

  const categorySegments = useCategoryChartSegments(overview.category_distribution);
  const locationBarRows: BarRow[] = useMemo(
    () =>
      (overview.location_distribution ?? []).map((row, i) => ({
        label: row.location_name ?? "未知",
        value: row.stock_qty,
        hint: `${row.kind_count} 种`,
        color: ["#3370ff", "#00b873", "#ff7d00", "#722ed1", "#13c2c2", "#f53f3f"][i % 6],
      })),
    [overview.location_distribution],
  );

  const ioBarRows: BarRow[] = useMemo(
    () => [
      { label: "入库", value: totals.inbound_quantity ?? 0, color: "#00b873" },
      { label: "出库", value: totals.outbound_quantity ?? 0, color: "#f53f3f" },
    ],
    [totals.inbound_quantity, totals.outbound_quantity],
  );

  const locationPieSegments = useLocationChartSegments(overview.location_distribution);

  return (
    <>
      <SectionCard className="flush-body dash-compact-head sticky-subnav sticky-subnav-card">
        <div className="dash-period-switch" role="tablist" aria-label="统计时间范围">
          {PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="tab"
              aria-selected={period === opt.value}
              className={`dash-period-btn ${period === opt.value ? "dash-period-btn-active" : ""}`}
              onClick={() => onPeriodChange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="dash-kpi-strip">
          <span>
            <strong>{totals.material_count ?? 0}</strong> 种
          </span>
          <span>
            <strong>{totals.inventory_quantity ?? 0}</strong> 件
          </span>
          <span>
            有货 <strong>{totals.in_stock_count ?? 0}</strong>
          </span>
          <span className="dash-kpi-warn">
            缺/零 <strong>{(totals.low_stock_count ?? 0) + (totals.zero_stock_count ?? 0)}</strong>
          </span>
          {actionCount > 0 && (
            <span className="dash-kpi-alert">
              待处理 <strong>{actionCount}</strong>
            </span>
          )}
        </div>
      </SectionCard>

      <SectionCard title="仓库全景" className="flush-body">
        <div className="dash-chart-grid">
          <ChartPanel title="物料状态">
            <div className="chart-donut-block">
              <DonutChart
                segments={stockStructure}
                centerTop={`${totals.material_count ?? 0}`}
                centerBottom="种"
                size={72}
              />
              <ChartLegend segments={stockStructure} unit="种" compact />
            </div>
          </ChartPanel>

          <ChartPanel title="分类库存">
            <div className="chart-donut-block">
              <DonutChart
                segments={categorySegments}
                centerTop={`${totals.inventory_quantity ?? 0}`}
                centerBottom="件"
                size={72}
              />
              <ChartLegend segments={categorySegments} unit="件" compact />
            </div>
          </ChartPanel>

          <ChartPanel title={`${activityLabel}出入库`} wide>
            <HorizontalBarChart rows={ioBarRows} unit="件" maxRows={2} />
          </ChartPanel>

          <ChartPanel title="库位库存" wide>
            {locationBarRows.length > 0 ? (
              <HorizontalBarChart rows={locationBarRows} unit="件" maxRows={6} />
            ) : (
              <div className="chart-empty">暂无库位数据</div>
            )}
            {(totals.empty_location_count ?? 0) > 0 && (
              <p className="dash-footnote">空库位 {totals.empty_location_count} 个</p>
            )}
          </ChartPanel>

          {locationPieSegments.length > 0 && (
            <ChartPanel title="库位占比" wide>
              <div className="chart-donut-block chart-donut-block-inline">
                <DonutChart segments={locationPieSegments} centerTop={`${totals.inventory_quantity ?? 0}`} centerBottom="件" size={68} />
                <ChartLegend segments={locationPieSegments} unit="件" compact />
              </div>
            </ChartPanel>
          )}
        </div>
      </SectionCard>

      {(pendingItems.length > 0 || lowStockItems.length > 0) && (
        <SectionCard title={`待处理 (${actionCount})`} className="flush-body">
          <div className="dash-compact-actions">
            {pendingItems.slice(0, 3).map((req) => (
              <button
                key={req.id}
                type="button"
                className="dash-action-chip"
                onClick={() => navigate("/history?view=approvals")}
              >
                <span className="dash-action-chip-tag">审</span>
                <span className="dash-action-chip-name">{req.material_name ?? req.material_id}</span>
                <span className="dash-action-chip-qty">{req.quantity}</span>
              </button>
            ))}
            {lowStockItems.slice(0, 3).map((item) => (
              <button
                key={item.id}
                type="button"
                className="dash-action-chip dash-action-chip-warn"
                onClick={() => navigate(`/purchase?material_id=${item.id}`)}
              >
                <span className="dash-action-chip-tag">缺</span>
                <span className="dash-action-chip-name">{item.name}</span>
                <span className="dash-action-chip-qty">{item.total_quantity}</span>
              </button>
            ))}
          </div>
          <div className="dash-action-links">
            {(totals.pending_requests ?? 0) > 0 && (
              <button type="button" className="dash-action-link" onClick={() => navigate("/history?view=approvals")}>
                审批 {totals.pending_requests} 条 →
              </button>
            )}
            {(totals.low_stock_count ?? 0) > 0 && (
              <button type="button" className="dash-action-link" onClick={() => navigate("/purchase")}>
                补货 {totals.low_stock_count} 种 →
              </button>
            )}
          </div>
        </SectionCard>
      )}

      <SectionCard title={`最近动态 · ${activityLabel}`} className="flush-body">
        {overview.recent_transactions?.length ? (
          <div className="tx-list tx-list-compact">
            {overview.recent_transactions.slice(0, 5).map((tx) => (
              <div className="tx-item tx-item-compact" key={tx.id}>
                <TxBadge type={tx.type} />
                <div className="tx-main">
                  <div className="tx-title">{tx.material_name ?? tx.material_id}</div>
                  <div className="tx-meta">
                    {tx.operator} · {formatDate(tx.created_at)}
                  </div>
                </div>
                <div className={`tx-qty ${tx.quantity > 0 ? "tx-qty-in" : "tx-qty-out"}`}>
                  {tx.quantity > 0 ? `+${tx.quantity}` : tx.quantity}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon="list" text={`${activityLabel}暂无流水`} />
        )}
      </SectionCard>

      <div className="panel-toolbar">
        <Button size="small" fill="outline" loading={loading} onClick={onRefresh}>
          刷新
        </Button>
        <Button size="small" color="primary" fill="outline" onClick={() => navigate("/purchase")}>
          进货
        </Button>
      </div>
    </>
  );
}
