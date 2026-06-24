import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Dialog, Form, Input, Selector, Stepper, Toast } from "antd-mobile";
import { listApprovalRequests, updateStockRequest } from "../api";
import type { StockRequest, StockRequestStatus } from "../api/types";
import { formatReturnPlan } from "../utils/requestDisplay";
import { useAuth } from "./AuthGate";
import { EmptyState, SectionCard, TxBadge } from "./ui";

const STATUS_OPTIONS: Array<{ label: string; value: StockRequestStatus | "ALL" }> = [
  { label: "待审批", value: "待审批" },
  { label: "已通过", value: "已通过" },
  { label: "已拒绝", value: "已拒绝" },
  { label: "全部", value: "ALL" },
];

function formatRequestLocation(item: StockRequest) {
  if (item.type === "入库" && !item.location_id) {
    return "库位待库管指定";
  }
  const base = item.location_name ?? item.location_id ?? "—";
  if (item.row != null && item.column != null) {
    return `${base} · ${item.row}行${item.column}列`;
  }
  return base;
}

/** 只读审批记录列表，审批操作统一在飞书原生审批中完成。 */
export function ApprovalRecords() {
  const { canApprove } = useAuth();
  const isAdmin = canApprove;
  const [items, setItems] = useState<StockRequest[]>([]);
  const [status, setStatus] = useState<StockRequestStatus | "ALL">("ALL");
  const [loading, setLoading] = useState(false);

  // ── 纠错弹窗 ──
  const [editTarget, setEditTarget] = useState<StockRequest | null>(null);
  const [editQty, setEditQty] = useState(1);
  const [editRemark, setEditRemark] = useState("");
  const [editBusy, setEditBusy] = useState(false);

  const openEdit = (item: StockRequest) => {
    setEditTarget(item);
    setEditQty(item.quantity);
    setEditRemark(item.remark ?? "");
  };
  const closeEdit = () => setEditTarget(null);

  const submitEdit = async () => {
    if (!editTarget) return;
    setEditBusy(true);
    try {
      await updateStockRequest(editTarget.id, {
        quantity: editQty,
        remark: editRemark.trim() || undefined,
      });
      Toast.show({ icon: "success", content: "已修正" });
      closeEdit();
      void load();
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "修正失败" });
    } finally {
      setEditBusy(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listApprovalRequests(
        status === "ALL" ? undefined : { status },
      );
      setItems(data);
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "加载审批记录失败" });
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  const pendingCount = useMemo(
    () => items.filter((i) => i.status === "待审批").length,
    [items],
  );

  return (
    <SectionCard
      title="审批记录"
      subtitle={
        pendingCount > 0
          ? `${pendingCount} 条待审批 — 请在飞书中审批`
          : "审批操作请在飞书客户端「审批」中完成"
      }
    >
      <div style={{ marginBottom: 12 }}>
        <Selector
          options={STATUS_OPTIONS}
          value={[status]}
          onChange={(vals) => {
            if (vals.length > 0) setStatus(vals[0] as StockRequestStatus | "ALL");
          }}
        />
      </div>

      {loading ? (
        <EmptyState icon="⏳" text="加载中…" />
      ) : items.length === 0 ? (
        <EmptyState icon="📋" text="暂无审批记录" />
      ) : (
        <div className="tx-list">
          {items.map((item) => (
            <div className="request-item" key={item.id}>
              <div className="request-item-header">
                <TxBadge type={item.type} />
                <span className={`request-status request-status-${item.status}`}>
                  {item.status}
                </span>
              </div>
              <div className="request-title">
                {item.material_name ?? item.material_id} ×{item.quantity}
              </div>
              <div className="tx-meta">
                {item.requester_name} · {formatRequestLocation(item)}
                {item.remark ? ` · ${item.remark}` : ""}
              </div>
              {item.type === "出库" && item.return_required && (
                <div className="tx-meta" style={{ marginTop: 4 }}>
                  {formatReturnPlan(item)}
                </div>
              )}
              {item.reject_reason && (
                <div className="tx-meta" style={{ marginTop: 4, color: "var(--sf-danger)" }}>
                  拒绝原因：{item.reject_reason}
                </div>
              )}
              <div className="tx-meta" style={{ marginTop: 4 }}>
                {item.approver_name ? `审批人：${item.approver_name} · ` : ""}
                {new Date(item.created_at).toLocaleString()}
              </div>
              {isAdmin && (
                <div style={{ marginTop: 6 }}>
                  <Button size="mini" fill="none" onClick={() => openEdit(item)}>
                    <span className="material-symbols-outlined" style={{fontSize:18}}>more_vert</span>
                    {" "}纠错
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog
        visible={editTarget !== null}
        title="数据纠错"
        onClose={closeEdit}
        actions={[
          { key: "cancel", text: "取消", onClick: closeEdit },
          { key: "save", text: editBusy ? "保存中…" : "保存", bold: true, onClick: () => void submitEdit() },
        ]}
        content={
          <Form layout="vertical">
            <Form.Item label="数量">
              <Stepper min={1} max={99999} value={editQty} onChange={setEditQty} />
            </Form.Item>
            <Form.Item label="备注说明">
              <Input value={editRemark} onChange={setEditRemark} placeholder="纠错原因或补充说明" />
            </Form.Item>
          </Form>
        }
      />
    </SectionCard>
  );
}
