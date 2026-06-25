import { useCallback, useEffect, useState } from "react";
import { Button, Dialog, Form, Input, Selector, Stepper, Toast } from "antd-mobile";
import {
  approveClosureRequest,
  createClosureRequest,
  directCloseBorrow,
  listClosureRequests,
  rejectClosureRequest,
} from "../api";
import type { DispositionType, LoanClosureRequest } from "../api/types";
import { useAuth } from "./AuthGate";
import { useDataMutationRefetch } from "../utils/dataMutation";
import { EmptyState, SectionCard } from "./ui";
import { formatHistoryDate } from "../utils/historyDisplay";

const DISPOSITION_OPTIONS: Array<{ label: string; value: DispositionType }> = [
  { label: "已消耗 / 产品交付", value: "已消耗" },
  { label: "已丢失", value: "已丢失" },
  { label: "领出后报废", value: "已报废" },
];

interface PendingClosuresPanelProps {
  showActions?: boolean;
  active?: boolean;
}

export function PendingClosuresPanel({ showActions = false, active = true }: PendingClosuresPanelProps) {
  const { canInbound } = useAuth();
  const [items, setItems] = useState<LoanClosureRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<LoanClosureRequest | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listClosureRequests(showActions ? { status: "待确认" } : undefined);
      setItems(data);
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "加载结案申请失败" });
    } finally {
      setLoading(false);
    }
  }, [showActions]);

  useEffect(() => {
    if (!active) return;
    void load();
  }, [load, active]);

  useDataMutationRefetch(["returns"], load, active);

  const handleApprove = async (item: LoanClosureRequest) => {
    const confirmed = await Dialog.confirm({
      content: `确认结案「${item.material_name}」×${item.quantity} 为 ${item.disposition_type}？\n不会修改库存，仅记录审计流水。`,
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      await approveClosureRequest(item.id);
      Toast.show({ icon: "success", content: "已确认结案" });
      void load();
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "确认失败" });
    } finally {
      setBusy(false);
    }
  };

  const handleReject = (item: LoanClosureRequest) => {
    setRejectTarget(item);
    setRejectReason("");
  };

  const submitReject = async () => {
    if (!rejectTarget) return;
    if (!rejectReason.trim()) {
      Toast.show({ content: "请填写拒绝原因" });
      return;
    }
    setBusy(true);
    try {
      await rejectClosureRequest(rejectTarget.id, rejectReason.trim());
      Toast.show({ icon: "success", content: "已拒绝" });
      setRejectTarget(null);
      setRejectReason("");
      void load();
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "拒绝失败" });
    } finally {
      setBusy(false);
    }
  };

  const pendingItems = showActions ? items.filter((item) => item.status === "待确认") : items;

  return (
    <SectionCard
      title={showActions ? "待确认结案" : "我的结案申请"}
      subtitle={
        showActions
          ? "研发提交的消耗/丢失/报废结案，确认后写入审计流水"
          : "提交后由库管确认，不会自动改库存"
      }
    >
      {pendingItems.length === 0 ? (
        <EmptyState
          loading={loading}
          icon="check-circle"
          text={loading ? "加载中…" : showActions ? "暂无待确认结案" : "暂无结案申请"}
        />
      ) : (
        <div className="tx-list">
          {pendingItems.map((item) => (
            <div className="request-item" key={item.id}>
              <div className="request-item-header">
                <span className={`request-status request-status-${item.status}`}>{item.status}</span>
                <span className="tx-meta">{item.disposition_type}</span>
              </div>
              <div className="request-title">
                {item.material_name ?? item.material_id} × {item.quantity}
              </div>
              <div className="tx-meta">
                {item.requester_name} · {formatHistoryDate(item.created_at)}
              </div>
              {item.note && <div className="tx-meta">说明：{item.note}</div>}
              {item.reject_reason && (
                <div className="tx-meta" style={{ color: "var(--sf-danger)" }}>
                  拒绝原因：{item.reject_reason}
                </div>
              )}
              {showActions && item.status === "待确认" && canInbound && (
                <div className="request-actions">
                  <Button size="mini" color="primary" disabled={busy} onClick={() => void handleApprove(item)}>
                    确认结案
                  </Button>
                  <Button size="mini" fill="outline" disabled={busy} onClick={() => handleReject(item)}>
                    拒绝
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <Dialog
        visible={rejectTarget !== null}
        title="拒绝结案申请"
        onClose={() => setRejectTarget(null)}
        actions={[
          { key: "cancel", text: "取消", onClick: () => setRejectTarget(null) },
          { key: "save", text: busy ? "提交中…" : "确认拒绝", bold: true, onClick: () => void submitReject() },
        ]}
        content={
          <Form layout="vertical">
            <Form.Item label="拒绝原因">
              <Input value={rejectReason} onChange={setRejectReason} placeholder="必填" />
            </Form.Item>
          </Form>
        }
      />
    </SectionCard>
  );
}

interface ClosureRequestDialogProps {
  visible: boolean;
  sourceTxId: string;
  maxQty: number;
  materialName?: string | null;
  onClose: () => void;
  onSubmitted: () => void;
}

export function ClosureRequestDialog({
  visible,
  sourceTxId,
  maxQty,
  materialName,
  onClose,
  onSubmitted,
}: ClosureRequestDialogProps) {
  const [dispositionType, setDispositionType] = useState<DispositionType>("已消耗");
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setDispositionType("已消耗");
    setQty(Math.max(1, maxQty));
    setNote("");
  }, [visible, maxQty, sourceTxId]);

  const submit = async () => {
    setSubmitting(true);
    try {
      await createClosureRequest({
        source_tx_id: sourceTxId,
        quantity: qty,
        disposition_type: dispositionType,
        note: note.trim() || undefined,
      });
      Toast.show({ icon: "success", content: "已提交结案申请" });
      onSubmitted();
      onClose();
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "提交失败" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      visible={visible}
      title="申请结案"
      onClose={onClose}
      actions={[
        { key: "cancel", text: "取消", onClick: onClose },
        { key: "save", text: submitting ? "提交中…" : "提交", bold: true, onClick: () => void submit() },
      ]}
      content={
        <Form layout="vertical">
          <div className="stock-hint" style={{ marginBottom: 8 }}>
            {materialName ?? "物料"} · 最多 {maxQty} 件 · 结案后不会走入库
          </div>
          <Form.Item label="处置类型">
            <Selector
              options={DISPOSITION_OPTIONS}
              value={[dispositionType]}
              onChange={(arr) => setDispositionType((arr[0] as DispositionType | undefined) ?? "已消耗")}
            />
          </Form.Item>
          <Form.Item label="数量">
            <Stepper min={1} max={maxQty} value={qty} onChange={setQty} />
          </Form.Item>
          <Form.Item label="说明（可选）">
            <Input value={note} onChange={setNote} placeholder="项目/原因" />
          </Form.Item>
        </Form>
      }
    />
  );
}

interface DirectCloseDialogProps {
  visible: boolean;
  sourceTxId: string;
  maxQty: number;
  materialName?: string | null;
  onClose: () => void;
  onSubmitted: () => void;
}

export function DirectCloseDialog({
  visible,
  sourceTxId,
  maxQty,
  materialName,
  onClose,
  onSubmitted,
}: DirectCloseDialogProps) {
  const [dispositionType, setDispositionType] = useState<DispositionType>("已消耗");
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setDispositionType("已消耗");
    setQty(Math.max(1, maxQty));
    setNote("");
  }, [visible, maxQty, sourceTxId]);

  const submit = async () => {
    setSubmitting(true);
    try {
      await directCloseBorrow({
        source_tx_id: sourceTxId,
        quantity: qty,
        disposition_type: dispositionType,
        note: note.trim() || undefined,
      });
      Toast.show({ icon: "success", content: "已结案" });
      onSubmitted();
      onClose();
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "结案失败" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      visible={visible}
      title="直接结案"
      onClose={onClose}
      actions={[
        { key: "cancel", text: "取消", onClick: onClose },
        { key: "save", text: submitting ? "提交中…" : "确认结案", bold: true, onClick: () => void submit() },
      ]}
      content={
        <Form layout="vertical">
          <div className="stock-hint" style={{ marginBottom: 8 }}>
            {materialName ?? "物料"} · 库管直接确认，不改库存
          </div>
          <Form.Item label="处置类型">
            <Selector
              options={DISPOSITION_OPTIONS}
              value={[dispositionType]}
              onChange={(arr) => setDispositionType((arr[0] as DispositionType | undefined) ?? "已消耗")}
            />
          </Form.Item>
          <Form.Item label="数量">
            <Stepper min={1} max={maxQty} value={qty} onChange={setQty} />
          </Form.Item>
          <Form.Item label="说明（可选）">
            <Input value={note} onChange={setNote} placeholder="产品交付 / 丢失说明" />
          </Form.Item>
        </Form>
      }
    />
  );
}
