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
    id: string;
    materialName: string;
    quantity: number;
    locationId: string;
    row: number;
    column: number;
  } | null>(null);

  const locationOptions = useMemo(
    () =>
      locations.map((loc) => ({
        label: `${loc.name}（${loc.code}）`,
        value: loc.id,
      })),
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

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      try {
        setLocations(await listLocations());
      } catch {
        // 审批页仍可加载申请列表
      }
    })();
  }, []);

  const approveOutbound = async (id: string) => {
    setReviewingId(id);
    try {
      await approveStockRequest(id);
      Toast.show({ icon: "success", content: "已审批通过并执行库存变更" });
      await load();
      onReviewed?.();
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "审批失败" });
    } finally {
      setReviewingId("");
    }
  };

  const openApproveInbound = (item: StockRequest) => {
    setApproveTarget({
      id: item.id,
      materialName: item.material_name ?? item.material_id,
      quantity: item.quantity,
      locationId: item.location_id ?? locations[0]?.id ?? "",
      row: 1,
      column: 1,
    });
  };

  const confirmApproveInbound = async () => {
    if (!approveTarget) return;
    if (!approveTarget.locationId) {
      Toast.show({ content: "请选择目标库位" });
      return;
    }
    const loc = locations.find((item) => item.id === approveTarget.locationId);
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
    } finally {
      setReviewingId("");
    }
  };

  const openReject = (id: string) => {
    setRejectTarget({ id, reason: "" });
  };

  const confirmReject = async () => {
    if (!rejectTarget) return;
    const reason = rejectTarget.reason.trim();
    if (!reason) {
      Toast.show({ content: "请填写拒绝原因" });
      return;
    }
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
    } finally {
      setReviewingId("");
    }
  };

  return (
    <>
      <SectionCard title="出入库审批" subtitle="入库归还由库管指定库位；审批通过后写入库存流水">
        <Selector
          options={STATUS_OPTIONS}
          value={[status]}
          onChange={(arr) => setStatus((arr[0] as StockRequestStatus | "ALL" | undefined) ?? "待审批")}
        />
        <div style={{ marginTop: 10 }}>
          <SearchBar
            placeholder="搜索申请人 / 物料 / 库位 / 说明"
            value={keyword}
            onChange={setKeyword}
            onSearch={() => void load()}
            onClear={() => {
              setKeyword("");
              void load();
            }}
          />
        </div>
      </SectionCard>

      <SectionCard title={loading ? "加载中…" : `申请列表 ${items.length} 条`}>
        {items.length === 0 ? (
          <EmptyState icon="📋" text="暂无申请" hint="用户提交申请后会显示在这里" />
        ) : (
          <div className="tx-list">
            {items.map((item) => (
              <div className="request-item" key={item.id}>
                <div className="request-item-header">
                  <TxBadge type={item.type} />
                  <span className={`request-status request-status-${item.status}`}>{item.status}</span>
                </div>
                <div className="request-title">
                  {item.material_name ?? item.material_id} × {item.quantity}
                </div>
                <div className="tx-meta">
                  {item.requester_name} · {formatRequestLocation(item)} ·{" "}
                  {new Date(item.created_at).toLocaleString()}
                </div>
                {item.remark && <div className="tx-meta">说明：{item.remark}</div>}
                {formatReturnPlan(item) && <div className="tx-meta">归还：{formatReturnPlan(item)}</div>}
                {item.reject_reason && <div className="tx-meta">拒绝原因：{item.reject_reason}</div>}
                {item.status === "待审批" && (
                  <div className="actions two request-actions">
                    <Button
                      color="danger"
                      fill="outline"
                      loading={reviewingId === item.id}
                      onClick={() => openReject(item.id)}
                    >
                      拒绝
                    </Button>
                    <Button
                      color="primary"
                      loading={reviewingId === item.id}
                      onClick={() =>
                        item.type === "入库" ? openApproveInbound(item) : void approveOutbound(item.id)
                      }
                    >
                      {item.type === "入库" ? "指定库位并通过" : "通过并执行"}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <Dialog
        visible={rejectTarget !== null}
        title="拒绝申请"
        content={
          <>
            <div className="reject-dialog-hint">请填写拒绝原因，申请人可在历史中查看。</div>
            <TextArea
              value={rejectTarget?.reason ?? ""}
              onChange={(reason) => setRejectTarget((prev) => (prev ? { ...prev, reason } : null))}
              placeholder="如：库存不足 / 用途不明确"
              rows={3}
              maxLength={200}
              showCount
            />
          </>
        }
        closeOnAction={false}
        closeOnMaskClick
        onClose={() => setRejectTarget(null)}
        actions={[
          { key: "cancel", text: "取消" },
          { key: "confirm", text: "确认拒绝", bold: true, danger: true },
        ]}
        onAction={(action) => {
          if (action.key === "confirm") {
            void confirmReject();
            return;
          }
          setRejectTarget(null);
        }}
      />

      <Dialog
        visible={approveTarget !== null}
        title="入库审批 · 指定库位"
        content={
          approveTarget ? (
            <>
              <div className="reject-dialog-hint">
                {approveTarget.materialName} × {approveTarget.quantity} — 请选择实际上架库位
              </div>
              <Form layout="vertical" className="form-card">
                <Form.Item label="目标库位">
                  <Selector
                    options={locationOptions}
                    value={approveTarget.locationId ? [approveTarget.locationId] : []}
                    onChange={(arr) =>
                      setApproveTarget((prev) =>
                        prev ? { ...prev, locationId: arr[0] ?? "", row: 1, column: 1 } : null,
                      )
                    }
                  />
                </Form.Item>
                {showApproveCabinetSlot && (
                  <>
                    <Form.Item label="货柜行号">
                      <Stepper
                        min={1}
                        max={20}
                        value={approveTarget.row}
                        onChange={(row) => setApproveTarget((prev) => (prev ? { ...prev, row } : null))}
                      />
                    </Form.Item>
                    <Form.Item label="货柜列号">
                      <Stepper
                        min={1}
                        max={20}
                        value={approveTarget.column}
                        onChange={(column) => setApproveTarget((prev) => (prev ? { ...prev, column } : null))}
                      />
                    </Form.Item>
                  </>
                )}
              </Form>
            </>
          ) : null
        }
        closeOnAction={false}
        closeOnMaskClick
        onClose={() => setApproveTarget(null)}
        actions={[
          { key: "cancel", text: "取消" },
          { key: "confirm", text: "确认入库", bold: true },
        ]}
        onAction={(action) => {
          if (action.key === "confirm") {
            void confirmApproveInbound();
            return;
          }
          setApproveTarget(null);
        }}
      />
    </>
  );
}
