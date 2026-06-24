import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Dialog, Form, Input, Stepper, Toast } from "antd-mobile";
import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { deleteTransaction, listTransactions, updateTransaction } from "../api";
import type { Transaction } from "../api/types";
import { useAuth } from "../components/AuthGate";
import { Layout } from "../components/Layout";
import { TransactionRow } from "../components/TransactionRow";
import { EmptyState, SectionCard } from "../components/ui";
import { openMaterialDetail } from "../utils/detailNavigation";
import { formatTxQuantity } from "../utils/historyDisplay";
import {
  TX_PAGE_SIZE,
  buildTransactionQueryParams,
  parseTransactionQuery,
  transactionQuerySummary,
  transactionQueryToApiArgs,
} from "../utils/transactionQuery";

export default function HistoryTransactionResultsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { canApprove } = useAuth();
  const query = useMemo(() => parseTransactionQuery(searchParams), [searchParams]);

  const [items, setItems] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [editTarget, setEditTarget] = useState<Transaction | null>(null);
  const [editQty, setEditQty] = useState(1);
  const [editRemark, setEditRemark] = useState("");
  const [editBusy, setEditBusy] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / TX_PAGE_SIZE));
  const backTo = `/history${canApprove ? "" : "?view=transactions"}`;

  const isFirstLoad = useRef(true);

  const load = useCallback(async () => {
    if (isFirstLoad.current) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    try {
      const data = await listTransactions(transactionQueryToApiArgs(query));
      setItems(data.items);
      setTotal(data.total);
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "加载流水失败" });
    } finally {
      setLoading(false);
      setRefreshing(false);
      isFirstLoad.current = false;
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [query.page]);

  const goToPage = (page: number) => {
    const next = buildTransactionQueryParams({ ...query, page });
    setSearchParams(next, { replace: true });
  };

  const openMaterial = (materialId: string) => {
    if (!materialId) return;
    openMaterialDetail(navigate, materialId, {
      backTo: `${location.pathname}${location.search}`,
    });
  };

  const confirmDeleteTx = async (tx: Transaction) => {
    if (tx.type === "移动") {
      Toast.show({ icon: "fail", content: "移动流水请用反向移动冲正，不可直接删除" });
      return;
    }
    const summary = `${tx.material_name ?? tx.material_id}\n${tx.location_name ?? tx.location_id}\n${formatTxQuantity(tx.type, tx.quantity)} · ${tx.operator}`;
    const revertHint =
      tx.type === "入库"
        ? "删除后将扣减对应库存。"
        : tx.type === "出库"
          ? "删除后将加回对应库存。"
          : "";
    const confirmed = await Dialog.confirm({
      title: "确认删除流水",
      content: `${summary}\n\n${revertHint}删除后不可恢复。`,
      confirmText: "删除",
      cancelText: "取消",
    });
    if (!confirmed) return;
    try {
      await deleteTransaction(tx.id);
      Toast.show({ icon: "success", content: "流水已删除" });
      void load();
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "删除失败" });
    }
  };

  const submitEdit = async () => {
    if (!editTarget) return;
    setEditBusy(true);
    try {
      await updateTransaction(editTarget.id, {
        quantity: editQty,
        remark: editRemark.trim() || undefined,
      });
      Toast.show({ icon: "success", content: "已修正" });
      setEditTarget(null);
      void load();
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "修正失败" });
    } finally {
      setEditBusy(false);
    }
  };

  const sectionTitle = loading && items.length === 0
    ? "加载中…"
    : total === 0
      ? "无匹配流水"
      : `共 ${total} 条 · 第 ${query.page}/${totalPages} 页${refreshing ? " · 更新中…" : ""}`;

  return (
    <>
      <Layout title="流水结果" backTo={backTo}>
        <SectionCard title={sectionTitle} subtitle={transactionQuerySummary(query)}>
          <div className={refreshing ? "tx-results-refreshing" : undefined}>
          {items.length === 0 && !loading ? (
            <EmptyState
              icon="list"
              text="未找到符合条件的流水"
              hint="返回修改筛选条件后重试"
            />
          ) : (
            items.map((tx) => (
              <TransactionRow
                key={tx.id}
                tx={tx}
                onOpenMaterial={openMaterial}
                canEdit={canApprove}
                onEdit={(t) => {
                  setEditTarget(t);
                  setEditQty(Math.abs(t.quantity));
                  setEditRemark(t.remark ?? "");
                }}
                onDelete={canApprove ? confirmDeleteTx : undefined}
              />
            ))
          )}

          {total > TX_PAGE_SIZE && (
            <div className="tx-pagination tx-pagination-sticky">
              <Button
                size="small"
                disabled={loading || refreshing || query.page <= 1}
                onClick={() => goToPage(query.page - 1)}
              >
                上一页
              </Button>
              <span className="tx-pagination-info">
                {query.page} / {totalPages}
              </span>
              <Button
                size="small"
                color="primary"
                disabled={loading || refreshing || query.page >= totalPages}
                onClick={() => goToPage(query.page + 1)}
              >
                下一页
              </Button>
            </div>
          )}
          </div>
        </SectionCard>
      </Layout>

      <Dialog
        visible={editTarget !== null}
        title="数据纠错"
        onClose={() => setEditTarget(null)}
        actions={[
          { key: "cancel", text: "取消", onClick: () => setEditTarget(null) },
          {
            key: "save",
            text: editBusy ? "保存中…" : "保存",
            bold: true,
            onClick: () => void submitEdit(),
          },
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
    </>
  );
}
