import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Dialog, Form, SearchBar, Selector, Stepper, TextArea, Toast } from "antd-mobile";
import { approveStockRequest, listApprovalRequests, listLocations, rejectStockRequest } from "../api";
import type { Location, StockRequest, StockRequestStatus } from "../api/types";
import { formatReturnPlan } from "../utils/requestDisplay";
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

export function ApprovalsPanel({ onReviewed }: { onReviewed?: () => void }) {
  const [items, setItems] = useState<StockRequest[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [status, setStatus] = useState<StockRequestStatus | "ALL">("待审批");
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [reviewingId, setReviewingId] = useState("");
  const [rejectTarget, setRejectTarget] = useState<{ id: string; reason: string } | null>(null);
  const [approveTarget, setApproveTarget] = useState<{
    id: string; materialName: string; quantity: number; locationId: string; row: number; column: number;
  } | null>(null);

  const locationOptions = useMemo(
    () => locations.map((loc) => ({ label: `${loc.name}（${loc.code}）`, value: loc.id })),
    [locations],
  );

  const selectedApproveLocation = useMemo(
    () => locations.find((loc) => loc.id === approveTarget?.locationId),
    [approveTarget?.locationId, locations],
  );
  const showApproveCabinetSlot = selectedApproveLocation?.type === "货柜";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listApprovalRequests({
        status: status === "ALL" ? undefined : status,
        keyword: keyword.trim() || undefined,
        limit: 200,
      });
      setItems(data);
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "加载申请失败" });
    } finally {
      setLoading(false);
    }
  }, [keyword, status]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    void (async () => {
      try { setLocations(await listLocations()); } catch { /* ok */ }
    })();
  }, []);

  const approveOutbound = async (id: string, materialName: string, quantity: number) => {
    const confirmed = await Dialog.confirm({
      content: `确认通过「${materialName}」出库 ${quantity} 件的申请？\n通过后将立即扣减库存。`,
    });
    if (!confirmed) return;
    setReviewingId(id);
    try {
      await approveStockRequest(id);
      Toast.show({ icon: "success", content: "已审批通过并执行库存变更" });
      await load();
      onReviewed?.();
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "审批失败" });
    } finally { setReviewingId(""); }
  };

  const openApproveInbound = (item: StockRequest) => {
    setApproveTarget({
      id: item.id, materialName: item.material_name ?? item.material_id,
      quantity: item.quantity, locationId: item.location_id ?? locations[0]?.id ?? "",
      row: 1, column: 1,
    });
  };

  const confirmApproveInbound = async () => {
    if (!approveTarget) return;
    if (!approveTarget.locationId) { Toast.show({ content: "请选择目标库位" }); return; }
    const loc = locations.find((l) => l.id === approveTarget.locationId);
    const isCabinet = loc?.type === "货柜";
    const { id, locationId, row, column } = approveTarget;
    setApproveTarget(null);
    setReviewingId(id);
    try {
      await approveStockRequest(id, {
        location_id: locationId,
        row: isCabinet ? row : undefined,
        column: isCabinet ? column : undefined,
      });
      Toast.show({ icon: "success", content: "已审批通过并完成入库上架" });
      await load();
      onReviewed?.();
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "审批失败" });
    } finally { setReviewingId(""); }
  };

  const openReject = (id: string) => { setRejectTarget({ id, reason: "" }); };
  const confirmReject = async () => {
    if (!rejectTarget) return;
    const reason = rejectTarget.reason.trim();
    if (!reason) { Toast.show({ content: "请填写拒绝原因" }); return; }
    const { id } = rejectTarget;
    setRejectTarget(null);
    setReviewingId(id);
    try {
      await rejectStockRequest(id, reason);
      Toast.show({ icon: "success", content: "已拒绝申请" });
      await load();
      onReviewed?.();
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "拒绝失败" });
    } finally { setReviewingId(""); }
  };

  return (
    <>
      <SectionCard title="出入库审批" subtitle="审批通过后库存自动变更；入库可由库管指定上架库位">
        <Selector
          options={STATUS_OPTIONS}
          value={[status]}
          onChange={(arr) => setStatus((arr[0] as StockRequestStatus | "ALL" | undefined) ?? "待审批")}
        />
        <div style={{ marginTop: 10 }}>
          <SearchBar
            placeholder="搜索申请人 / 物料 / 库位"
            value={keyword}
            onChange={setKeyword}
            onSearch={() => void load()}
            onClear={() => { setKeyword(""); void load(); }}
          />
        </div>
      </SectionCard>

      {loading ? (
        <EmptyState icon="loading" text="加载中…" />
      ) : items.length === 0 ? (
        <EmptyState icon="list" text="暂无申请" hint={keyword ? "试试清空搜索" : "暂无待审批的出入库申请"} />
      ) : (
        <div className="tx-list">
          {items.map((item) => (
            <div className="request-item" key={item.id}>
              <div className="request-item-header">
                <TxBadge type={item.type} />
                <span className={`request-status request-status-${item.status}`}>{item.status}</span>
              </div>
              <div className="request-title">{item.material_name ?? item.material_id} × {item.quantity}</div>
              <div className="tx-meta">
                {item.requester_name} · {formatRequestLocation(item)} · {new Date(item.created_at).toLocaleString()}
              </div>
              {item.remark && <div className="tx-meta">说明：{item.remark}</div>}
              {formatReturnPlan(item) && <div className="tx-meta">归还：{formatReturnPlan(item)}</div>}
              {item.status === "待审批" && (
                <div className="actions two request-actions">
                  <Button color="danger" fill="outline" loading={reviewingId === item.id} onClick={() => openReject(item.id)}>拒绝</Button>
                  <Button color="primary" loading={reviewingId === item.id}
                    onClick={() => item.type === "入库" ? openApproveInbound(item) : void approveOutbound(item.id, item.material_name ?? item.material_id, item.quantity)}>
                    {item.type === "入库" ? "指定库位并通过" : "通过并执行"}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog
        visible={rejectTarget !== null}
        title="拒绝申请"
        content={
          <>
            <div className="reject-dialog-hint">请填写拒绝原因，申请人可查看。</div>
            <TextArea value={rejectTarget?.reason ?? ""} onChange={(reason) => setRejectTarget((prev) => prev ? { ...prev, reason } : null)} placeholder="如：库存不足" rows={3} />
          </>
        }
        actions={[
          { key: "cancel", text: "取消", onClick: () => setRejectTarget(null) },
          { key: "confirm", text: reviewingId ? "提交中…" : "确认拒绝", danger: true, bold: true, onClick: () => void confirmReject() },
        ]}
        onClose={() => setRejectTarget(null)}
      />

      <Dialog
        visible={approveTarget !== null}
        title={`审批入库 — ${approveTarget?.materialName ?? ""}`}
        content={
          <Form layout="vertical">
            <Form.Item label="目标库位">
              <Selector options={locationOptions} value={approveTarget?.locationId ? [approveTarget.locationId] : []}
                onChange={(vals) => setApproveTarget((prev) => prev ? { ...prev, locationId: vals[0] ?? "" } : null)} />
            </Form.Item>
            {showApproveCabinetSlot && (
              <>
                <Form.Item label="货柜行号"><Stepper min={1} max={20} value={approveTarget?.row ?? 1} onChange={(v) => setApproveTarget((prev) => prev ? { ...prev, row: v } : null)} /></Form.Item>
                <Form.Item label="货柜列号"><Stepper min={1} max={20} value={approveTarget?.column ?? 1} onChange={(v) => setApproveTarget((prev) => prev ? { ...prev, column: v } : null)} /></Form.Item>
              </>
            )}
          </Form>
        }
        actions={[
          { key: "cancel", text: "取消", onClick: () => setApproveTarget(null) },
          { key: "approve", text: reviewingId ? "执行中…" : "确认入库", bold: true, onClick: () => void confirmApproveInbound() },
        ]}
        onClose={() => setApproveTarget(null)}
      />
    </>
  );
}
