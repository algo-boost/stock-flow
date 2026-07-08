import { useCallback, useEffect, useState } from "react";
import { Button, SearchBar, Toast } from "antd-mobile";
import { useLocation, useNavigate } from "react-router-dom";
import { listPendingReturns } from "../api";
import type { PendingReturn } from "../api/types";
import { useAuth } from "./AuthGate";
import { EmptyState, SectionCard } from "./ui";
import { useDataMutationRefetch } from "../utils/dataMutation";
import { openMaterialDetail, openStockPage } from "../utils/detailNavigation";
import { formatHistoryDate } from "../utils/historyDisplay";

interface PendingReturnsPanelProps {
  /** 库管/管理员可按借用人筛选 */
  showBorrowerFilter?: boolean;
}

export function PendingReturnsPanel({
  showBorrowerFilter = false,
  active = true,
}: PendingReturnsPanelProps & { active?: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { canInbound } = useAuth();
  const [items, setItems] = useState<PendingReturn[]>([]);
  const [borrowerFilter, setBorrowerFilter] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listPendingReturns(
        showBorrowerFilter ? borrowerFilter.trim() || undefined : undefined,
      );
      setItems(data);
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "加载待归还失败" });
    } finally {
      setLoading(false);
    }
  }, [borrowerFilter, showBorrowerFilter]);

  useEffect(() => {
    if (!active) return;
    void load();
  }, [load, active]);

  useDataMutationRefetch(["returns", "inventory"], load, active);

  useEffect(() => {
    if (!active) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void load();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load, active]);

  const goReturn = (item: PendingReturn) => {
    openStockPage(navigate, "inbound", {
      materialId: item.material_id,
      materialBackTo: "/history?view=returns",
      detailBackTo: "/history?view=returns",
      searchParams: {
        location_id: item.location_id,
        qty: item.quantity,
        return_note: "归还",
      },
    });
  };

  const overdueCount = items.filter((item) => item.overdue).length;

  return (
    <>
      <SectionCard
        title={loading ? "加载中…" : `待归还 ${items.length} 条`}
        subtitle={
          showBorrowerFilter
            ? "出库时标记「需要归还」的领用；入库备注含「归还」后自动核销"
            : "您借出且尚未归还的物料；到期项会高亮提醒"
        }
      >
        {showBorrowerFilter && (
          <>
            <SearchBar
              placeholder="按借用人筛选（留空查看全部）"
              value={borrowerFilter}
              onChange={setBorrowerFilter}
              onSearch={() => void load()}
              onClear={() => {
                setBorrowerFilter("");
                void load();
              }}
            />
            <div style={{ marginTop: 10 }}>
              <Button block color="primary" loading={loading} onClick={() => void load()}>
                查询
              </Button>
            </div>
          </>
        )}
        {overdueCount > 0 && (
          <div className="returns-overdue-banner">有 {overdueCount} 条已超过预计归还日期</div>
        )}
      </SectionCard>

      <SectionCard title="待归还清单">
        {items.length === 0 ? (
          <EmptyState
            loading={loading}
            icon="check-circle"
            text={loading ? "加载中…" : "暂无待归还物料"}
            hint={
              showBorrowerFilter
                ? "出库时选择「需要归还」后会出现在此"
                : "出库申请选择「需要归还」且审批通过后会计入"
            }
          />
        ) : (
          items.map((item) => (
            <div className={`request-item ${item.overdue ? "return-item-overdue" : ""}`} key={item.source_tx_id}>
              <div className="request-item-header">
                <span className={`request-status ${item.overdue ? "request-status-已拒绝" : "request-status-待审批"}`}>
                  {item.overdue ? "已逾期" : "待归还"}
                </span>
                <span className="tx-meta">× {item.quantity}</span>
              </div>
              <button
                type="button"
                className="history-link-title request-title"
                onClick={() =>
                  openMaterialDetail(navigate, item.material_id, {
                    backTo: `${location.pathname}${location.search}`,
                  })
                }
              >
                {item.material_name ?? item.material_id}
              </button>
              <div className="tx-meta">
                {item.location_name ?? item.location_id} · 借用人 {item.borrower}
              </div>
              <div className="tx-meta">
                借出 {formatHistoryDate(item.borrowed_at)}
                {item.return_due_at ? ` · 预计归还 ${item.return_due_at}` : " · 需归还"}
              </div>
              {item.note && <div className="tx-meta">说明：{item.note}</div>}
              <div className="request-actions" style={{ marginTop: 10 }}>
                <Button color="primary" fill="outline" onClick={() => goReturn(item)}>
                  {canInbound ? "去入库归还" : "申请归还"}
                </Button>
              </div>
            </div>
          ))
        )}
      </SectionCard>

      {!showBorrowerFilter && (
        <div className="stock-hint" style={{ padding: "0 12px 12px" }}>
          实物回库请点「申请归还」，库管审批入库时指定库位。
        </div>
      )}
    </>
  );
}
