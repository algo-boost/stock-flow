import { useCallback, useEffect, useState } from "react";
import { Button, SearchBar, Selector, Toast } from "antd-mobile";
import { approveStockRequest, listApprovalRequests, rejectStockRequest } from "../api";
import type { StockRequest, StockRequestStatus } from "../api/types";
import { EmptyState, SectionCard, TxBadge } from "./ui";

const STATUS_OPTIONS: Array<{ label: string; value: StockRequestStatus | "ALL" }> = [
  { label: "待审批", value: "待审批" },
  { label: "已通过", value: "已通过" },
  { label: "已拒绝", value: "已拒绝" },
  { label: "全部", value: "ALL" },
];

export function ApprovalsPanel({ onReviewed }: { onReviewed?: () => void }) {
  const [items, setItems] = useState<StockRequest[]>([]);
  const [status, setStatus] = useState<StockRequestStatus | "ALL">("待审批");
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [reviewingId, setReviewingId] = useState("");

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

  const approve = async (id: string) => {
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

  const reject = async (id: string) => {
    const reason = window.prompt("请输入拒绝原因");
    if (!reason?.trim()) return;
    setReviewingId(id);
    try {
      await rejectStockRequest(id, reason.trim());
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
      <SectionCard title="出入库审批" subtitle="审批通过后才会真正写入库存流水">
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
                  {item.requester_name} · {item.location_name ?? item.location_id} ·{" "}
                  {new Date(item.created_at).toLocaleString()}
                </div>
                {item.remark && <div className="tx-meta">说明：{item.remark}</div>}
                {item.reject_reason && <div className="tx-meta">拒绝原因：{item.reject_reason}</div>}
                {item.status === "待审批" && (
                  <div className="actions two request-actions">
                    <Button fill="outline" loading={reviewingId === item.id} onClick={() => reject(item.id)}>
                      拒绝
                    </Button>
                    <Button color="primary" loading={reviewingId === item.id} onClick={() => approve(item.id)}>
                      通过并执行
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </>
  );
}
