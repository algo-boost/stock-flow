import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Dialog, Form, Input, Selector, Stepper, Toast, ActionSheet } from "antd-mobile";
import { approveStockRequest, listApprovalRequests, listLocations, rejectStockRequest, updateStockRequest, deleteStockRequest } from "../api";
import type { Location, StockRequest, StockRequestStatus } from "../api/types";
import { formatReturnPlan } from "../utils/requestDisplay";
import { useAuth } from "./AuthGate";
import {
  ApprovalLocationForm,
  buildApprovalLocationPayload,
  isApprovalLocationComplete,
  type ApprovalLocationValue,
} from "./ApprovalLocationForm";
import { useDataMutationRefetch } from "../utils/dataMutation";
import { EmptyState, SectionCard, TxBadge } from "./ui";
import { FeishuIcon } from "./FeishuIcon";

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

/** 审批记录列表，管理员可修改/删除。 */
export function ApprovalRecords({ active = true }: { active?: boolean }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [items, setItems] = useState<StockRequest[]>([]);
  const [status, setStatus] = useState<StockRequestStatus | "ALL">("ALL");
  const [loading, setLoading] = useState(false);

  // ── 纠错弹窗 ──
  const [editTarget, setEditTarget] = useState<StockRequest | null>(null);
  const [editQty, setEditQty] = useState(1);
  const [editRemark, setEditRemark] = useState("");
  const [editBusy, setEditBusy] = useState(false);

  // ── 操作菜单（修改/删除，仅 ADMIN） ──
  const [menuTarget, setMenuTarget] = useState<StockRequest | null>(null);

  const openMenu = (item: StockRequest) => setMenuTarget(item);
  const closeMenu = () => setMenuTarget(null);

  const handleMenuAction = async (action: string) => {
    if (!menuTarget) return;
    const item = menuTarget;
    setMenuTarget(null);

    if (action === "edit") {
      setEditTarget(item);
      setEditQty(item.quantity);
      setEditRemark(item.remark ?? "");
    } else if (action === "delete") {
      const label = item.material_name ?? item.id;
      const confirmed = await Dialog.confirm({ content: `确定删除申请「${label}」？\n此操作不可恢复。` });
      if (!confirmed) return;
      setEditBusy(true);
      try {
        await deleteStockRequest(item.id);
        Toast.show({ icon: "success", content: "已删除" });
        void load();
      } catch (e) {
        Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "删除失败" });
      } finally {
        setEditBusy(false);
      }
    }
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

  const [rejectTarget, setRejectTarget] = useState<StockRequest | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const [approveTarget, setApproveTarget] = useState<StockRequest | null>(null);
  const [approveLocation, setApproveLocation] = useState<ApprovalLocationValue>({ location_id: "" });
  const [locations, setLocations] = useState<Location[]>([]);

  const loadLocations = useCallback(async () => {
    try {
      setLocations(await listLocations());
    } catch {
      setLocations([]);
    }
  }, []);

  useEffect(() => {
    void loadLocations();
  }, [loadLocations]);

  useDataMutationRefetch(["locations"], loadLocations);

  const approveLocationObj = useMemo(
    () => locations.find((loc) => loc.id === approveLocation.location_id),
    [approveLocation.location_id, locations],
  );

  const closeApprove = () => {
    setApproveTarget(null);
    setApproveLocation({ location_id: "" });
  };

  const handleApprove = (item: StockRequest) => {
    if (item.type === "入库" && !item.location_id) {
      setApproveTarget(item);
      setApproveLocation({ location_id: "", row: undefined, column: undefined });
      return;
    }
    void submitApprove(item, buildApprovalLocationPayload(item.type, item.location_id, { location_id: item.location_id ?? "" }));
  };

  const submitApprove = async (
    item: StockRequest,
    payload?: { location_id?: string; row?: number; column?: number },
  ) => {
    if (item.type === "入库" && !item.location_id && !payload?.location_id) {
      Toast.show({ content: "入库审批必须指定目标库位" });
      return;
    }
    const confirmed = await Dialog.confirm({
      content: `通过「${item.material_name ?? item.id}」${item.type}申请 ×${item.quantity}？`,
    });
    if (!confirmed) return;
    setEditBusy(true);
    try {
      await approveStockRequest(item.id, payload);
      Toast.show({ icon: "success", content: "已通过" });
      closeApprove();
      void load();
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "审批失败" });
    } finally {
      setEditBusy(false);
    }
  };

  const confirmApproveWithLocation = () => {
    if (!approveTarget) return;
    if (!isApprovalLocationComplete(approveLocation, approveLocationObj)) {
      Toast.show({ content: "请选择目标库位与具体格位" });
      return;
    }
    const payload = buildApprovalLocationPayload(
      approveTarget.type,
      approveTarget.location_id,
      approveLocation,
      approveLocationObj,
    );
    void submitApprove(approveTarget, payload);
  };

  const submitReject = async () => {
    if (!rejectTarget) return;
    if (!rejectReason.trim()) {
      Toast.show({ content: "请填写拒绝原因" });
      return;
    }
    setEditBusy(true);
    try {
      await rejectStockRequest(rejectTarget.id, rejectReason.trim());
      Toast.show({ icon: "success", content: "已拒绝" });
      setRejectTarget(null);
      setRejectReason("");
      void load();
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "拒绝失败" });
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
    if (!active) return;
    void load();
  }, [load, active]);

  useDataMutationRefetch(["requests", "inventory"], load, active);

  const pendingCount = useMemo(
    () => items.filter((i) => i.status === "待审批").length,
    [items],
  );

  return (
    <SectionCard
      title="审批记录"
      subtitle={
        pendingCount > 0
          ? `${pendingCount} 条待审批 · 可在此直接处理`
          : "已通过/已拒绝的历史记录"
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
        <EmptyState loading text="加载中…" />
      ) : items.length === 0 ? (
        <EmptyState icon="list" text="暂无审批记录" />
      ) : (
        <div className="tx-list">
          {items.map((item) => (
            <div className="request-item" key={item.id}>
              <div className="request-item-top">
                <div className="request-item-header">
                  <TxBadge type={item.type} />
                  <span className={`request-status request-status-${item.status}`}>
                    {item.status}
                  </span>
                </div>
                {isAdmin && item.status !== "待审批" && (
                  <button
                    type="button"
                    className="request-menu-btn"
                    aria-label="更多操作"
                    onClick={() => openMenu(item)}
                  >
                    <FeishuIcon name="more-horizontal" size={18} />
                  </button>
                )}
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
              {item.status === "待审批" && isAdmin && (
                <div className="request-actions">
                  <Button size="mini" color="primary" disabled={editBusy} onClick={() => handleApprove(item)}>
                    通过
                  </Button>
                  <Button
                    size="mini"
                    fill="outline"
                    disabled={editBusy}
                    onClick={() => {
                      setRejectTarget(item);
                      setRejectReason("");
                    }}
                  >
                    拒绝
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog
        visible={approveTarget !== null}
        title="审批入库 — 指定库位"
        onClose={closeApprove}
        actions={[
          { key: "cancel", text: "取消", onClick: closeApprove },
          {
            key: "save",
            text: editBusy ? "提交中…" : "确认通过",
            bold: true,
            onClick: confirmApproveWithLocation,
          },
        ]}
        content={
          approveTarget ? (
            <>
              <div className="stock-hint" style={{ marginBottom: 8 }}>
                {approveTarget.material_name} × {approveTarget.quantity} · 归还上架由库管指定库位/格位
              </div>
              <ApprovalLocationForm
                required
                materialId={approveTarget.material_id}
                value={approveLocation}
                onChange={setApproveLocation}
              />
            </>
          ) : null
        }
      />

      <Dialog
        visible={rejectTarget !== null}
        title="拒绝申请"
        onClose={() => setRejectTarget(null)}
        actions={[
          { key: "cancel", text: "取消", onClick: () => setRejectTarget(null) },
          { key: "save", text: editBusy ? "提交中…" : "确认拒绝", bold: true, onClick: () => void submitReject() },
        ]}
        content={
          <Form layout="vertical">
            <Form.Item label="拒绝原因">
              <Input value={rejectReason} onChange={setRejectReason} placeholder="必填" />
            </Form.Item>
          </Form>
        }
      />

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

      <ActionSheet
        visible={menuTarget !== null}
        actions={[
          { text: "修改数据", key: "edit" },
          { text: "删除记录", key: "delete", danger: true },
        ]}
        onClose={closeMenu}
        onAction={async (action) => {
          await handleMenuAction(String(action.key));
        }}
        cancelText="取消"
      />
    </SectionCard>
  );
}
