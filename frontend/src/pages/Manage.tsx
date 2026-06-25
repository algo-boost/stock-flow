import { useCallback, useEffect, useState } from "react";
import { Button, Dialog, Form, Input, Stepper, Tabs, Toast } from "antd-mobile";
import { useSearchParams } from "react-router-dom";
import { getAdminAudit, getAdminOverview, updateStockRequest, updateTransaction } from "../api";
import type { AdminAudit, AdminOverview, StockRequest, Transaction } from "../api/types";
import { AuthGate, useAuth } from "../components/AuthGate";
import { Layout } from "../components/Layout";
import { AdminSystemPanel } from "../components/AdminSystemPanel";
import { CategoryManagePanel } from "../components/CategoryManagePanel";
import { LocationManagePanel } from "../components/LocationManagePanel";
import { EmptyState, SectionCard, TxBadge } from "../components/ui";
import { FeishuIcon } from "../components/FeishuIcon";
import {
  resolveDashboardPeriod,
  WarehouseDashboard,
  type DashboardPeriod,
} from "../components/WarehouseDashboard";

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function ManageContent() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { canApprove, setPendingCount } = useAuth();
  const rawTab = searchParams.get("tab") ?? (canApprove ? "dashboard" : "locations");
  const activeTab = rawTab === "overview" ? "dashboard" : rawTab;
  const [period, setPeriod] = useState<DashboardPeriod>("7d");
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [audit, setAudit] = useState<AdminAudit | null>(null);
  const [loading, setLoading] = useState(false);

  const [editTarget, setEditTarget] = useState<{ type: "tx" | "req"; item: Transaction | StockRequest } | null>(null);
  const [editQty, setEditQty] = useState(1);
  const [editRemark, setEditRemark] = useState("");
  const [editBusy, setEditBusy] = useState(false);

  const openEdit = (type: "tx" | "req", item: Transaction | StockRequest) => {
    setEditTarget({ type, item });
    setEditQty(Math.abs(item.quantity));
    setEditRemark(item.remark ?? "");
  };
  const closeEdit = () => setEditTarget(null);

  const submitEdit = async () => {
    if (!editTarget) return;
    setEditBusy(true);
    try {
      const payload = { quantity: editQty, remark: editRemark.trim() || undefined };
      if (editTarget.type === "tx") {
        await updateTransaction(editTarget.item.id, payload);
      } else {
        await updateStockRequest(editTarget.item.id, payload);
      }
      Toast.show({ icon: "success", content: "已修正" });
      closeEdit();
      void loadDashboard();
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "修正失败" });
    } finally {
      setEditBusy(false);
    }
  };

  const loadDashboard = useCallback(async (opts?: { silent?: boolean }) => {
    if (!canApprove) return;
    if (!opts?.silent) setLoading(true);
    try {
      const range = resolveDashboardPeriod(period);
      const overviewData = await getAdminOverview(range);
      setOverview(overviewData);
      setPendingCount(overviewData.totals.pending_requests);
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "加载失败" });
    } finally {
      setLoading(false);
    }
  }, [canApprove, period, setPendingCount]);

  const loadAudit = useCallback(async () => {
    if (!canApprove) return;
    setLoading(true);
    try {
      const auditData = await getAdminAudit({ limit: 30 });
      setAudit(auditData);
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "加载失败" });
    } finally {
      setLoading(false);
    }
  }, [canApprove]);

  useEffect(() => {
    if (!canApprove || activeTab !== "dashboard") return;
    void loadDashboard();
  }, [activeTab, canApprove, loadDashboard]);

  useEffect(() => {
    if (!canApprove || activeTab !== "audit") return;
    if (audit) return;
    void loadAudit();
  }, [activeTab, audit, canApprove, loadAudit]);

  useEffect(() => {
    if (rawTab === "overview") {
      const next = new URLSearchParams(searchParams);
      next.set("tab", "dashboard");
      setSearchParams(next, { replace: true });
    }
  }, [rawTab, searchParams, setSearchParams]);

  const onTabChange = (key: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", key);
    setSearchParams(next, { replace: true });
  };

  if (!canApprove) {
    return (
      <Layout title="管理">
        <Tabs defaultActiveKey="locations" className="compact-tabs manage-tabs sticky-page-tabs">
          <Tabs.Tab title="库位" key="locations">
            <LocationManagePanel />
          </Tabs.Tab>
          <Tabs.Tab title="分类" key="categories">
            <CategoryManagePanel />
          </Tabs.Tab>
          <Tabs.Tab title="同步" key="sync">
            <AdminSystemPanel />
          </Tabs.Tab>
        </Tabs>
      </Layout>
    );
  }

  return (
    <Layout title="管理">
      <Tabs activeKey={activeTab} onChange={onTabChange} className="compact-tabs manage-tabs sticky-page-tabs">
        <Tabs.Tab title="概况" key="dashboard">
          {!overview ? (
            <EmptyState loading text="加载中…" />
          ) : (
            <>
              <WarehouseDashboard
                overview={overview}
                period={period}
                loading={loading}
                onPeriodChange={setPeriod}
                onRefresh={() => void loadDashboard()}
              />
            </>
          )}
        </Tabs.Tab>

        <Tabs.Tab title="库位" key="locations">
          <LocationManagePanel />
        </Tabs.Tab>

        <Tabs.Tab title="分类" key="categories">
          <CategoryManagePanel />
        </Tabs.Tab>

        <Tabs.Tab title="系统" key="system">
          <AdminSystemPanel onRefreshed={() => void loadDashboard({ silent: true })} />
        </Tabs.Tab>

        <Tabs.Tab title="审计" key="audit">
          <SectionCard title="操作审计">
            {audit?.recent_transactions.length ? (
              <div className="tx-list">
                {audit.recent_transactions.slice(0, 15).map((tx) => (
                  <div className="tx-item" key={tx.id}>
                    <TxBadge type={tx.type} />
                    <div className="tx-main">
                      <div className="tx-title">{tx.material_name ?? tx.material_id}</div>
                      <div className="tx-meta">
                        {tx.operator} · {formatDate(tx.created_at)}
                      </div>
                    </div>
                    <div className="tx-qty">{tx.quantity > 0 ? `+${tx.quantity}` : tx.quantity}</div>
                    <Button size="mini" fill="none" onClick={() => openEdit("tx", tx)}>
                      <FeishuIcon name="more-vertical" size={18} />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon="list" text="暂无审计流水" />
            )}
          </SectionCard>
        </Tabs.Tab>
      </Tabs>

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
            <Form.Item label="备注">
              <Input value={editRemark} onChange={setEditRemark} placeholder="纠错原因" />
            </Form.Item>
          </Form>
        }
      />
    </Layout>
  );
}

export default function ManagePage() {
  return (
    <AuthGate
      roles={["KEEPER", "ADMIN"]}
      fallback={
        <Layout title="管理">
          <EmptyState icon="lock" text="暂无权限" hint="库位维护需要库管员或管理员角色" />
        </Layout>
      }
    >
      <ManageContent />
    </AuthGate>
  );
}
