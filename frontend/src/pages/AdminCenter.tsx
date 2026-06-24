import { useCallback, useEffect, useState } from "react";
import { Button, Dialog, Form, Input, Stepper, Tabs, Toast, ActionSheet } from "antd-mobile";
import { useNavigate, useSearchParams } from "react-router-dom";
import { getAdminAudit, getAdminOverview, updateTransaction, updateStockRequest, deleteTransaction, deleteStockRequest } from "../api";
import type { AdminAudit, AdminOverview, StockRequest, Transaction } from "../api/types";
import { AuthGate, useAuth } from "../components/AuthGate";
import { Layout } from "../components/Layout";
import { EmptyState, SectionCard, StatCard, TxBadge } from "../components/ui";

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function AdminCenterContent() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") ?? "dashboard";
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [audit, setAudit] = useState<AdminAudit | null>(null);
  const [loading, setLoading] = useState(false);
  const { setPendingCount } = useAuth();

  // ── 纠错弹窗 ──
  const [editTarget, setEditTarget] = useState<{ type: "tx" | "req"; item: Transaction | StockRequest } | null>(null);
  const [editQty, setEditQty] = useState(1);
  const [editRemark, setEditRemark] = useState("");
  const [editBusy, setEditBusy] = useState(false);

  // ── 操作菜单（修改/删除） ──
  const [menuTarget, setMenuTarget] = useState<{ type: "tx" | "req"; item: Transaction | StockRequest } | null>(null);

  const openMenu = (type: "tx" | "req", item: Transaction | StockRequest) => setMenuTarget({ type, item });
  const closeMenu = () => setMenuTarget(null);

  const handleMenuAction = async (action: string) => {
    if (!menuTarget) return;
    const { type, item } = menuTarget;
    setMenuTarget(null);

    if (action === "edit") {
      setEditTarget({ type, item });
      setEditQty(Math.abs(item.quantity));
      setEditRemark(item.remark ?? "");
    } else if (action === "delete") {
      const label = type === "tx"
        ? `流水 · ${(item as Transaction).material_name ?? item.id}`
        : `申请 · ${(item as StockRequest).material_name ?? item.id}`;
      const confirmed = await Dialog.confirm({ content: `确定删除「${label}」？\n此操作不可恢复。` });
      if (!confirmed) return;
      setEditBusy(true);
      try {
        if (type === "tx") {
          await deleteTransaction(item.id);
        } else {
          await deleteStockRequest(item.id);
        }
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
      const payload = { quantity: editQty, remark: editRemark.trim() || undefined };
      if (editTarget.type === "tx") {
        await updateTransaction(editTarget.item.id, payload);
      } else {
        await updateStockRequest(editTarget.item.id, payload);
      }
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
      const [overviewData, auditData] = await Promise.all([
        getAdminOverview(),
        getAdminAudit({ limit: 30 }),
      ]);
      setOverview(overviewData);
      setAudit(auditData);
      setPendingCount(overviewData.totals.pending_requests);
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "加载运营数据失败" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onTabChange = (key: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", key);
    setSearchParams(next, { replace: true });
  };

  return (
    <Layout title="运营中心">
      <Tabs activeKey={activeTab} onChange={onTabChange}>
        <Tabs.Tab title="数据看板" key="dashboard">
          {overview && (
            <>
              <SectionCard title="库存与流水趋势" subtitle="出入库对比、审批状态分布">
                <div className="dash-section">
                  <div className="dash-label">出入库对比</div>
                  <div className="dash-bar-group">
                    <div className="dash-bar-row">
                      <span className="dash-bar-tag">入库</span>
                      <div className="dash-bar-track"><div className="dash-bar-fill dash-bar-in" style={{width:`${Math.min(100,((overview.totals.inbound_quantity||0)/Math.max(1,(overview.totals.inbound_quantity||0)+(overview.totals.outbound_quantity||0)))*100)}%`}}/></div>
                      <span className="dash-bar-val">{overview.totals.inbound_quantity ?? 0}件</span>
                    </div>
                    <div className="dash-bar-row">
                      <span className="dash-bar-tag">出库</span>
                      <div className="dash-bar-track"><div className="dash-bar-fill dash-bar-out" style={{width:`${Math.min(100,((overview.totals.outbound_quantity||0)/Math.max(1,(overview.totals.inbound_quantity||0)+(overview.totals.outbound_quantity||0)))*100)}%`}}/></div>
                      <span className="dash-bar-val">{overview.totals.outbound_quantity ?? 0}件</span>
                    </div>
                  </div>
                </div>
                <div className="dash-section">
                  <div className="dash-label">审批状态</div>
                  <div className="dash-bar-row"><span className="dash-bar-tag">待审批</span><div className="dash-bar-track"><div className="dash-bar-fill dash-bar-warn" style={{width:`${Math.min(100,((overview.totals.pending_requests||0)/Math.max(1,overview.totals.pending_requests+overview.totals.approved_requests+overview.totals.rejected_requests))*100)}%`}}/></div><span className="dash-bar-val">{overview.totals.pending_requests ?? 0}</span></div>
                  <div className="dash-bar-row"><span className="dash-bar-tag">已通过</span><div className="dash-bar-track"><div className="dash-bar-fill dash-bar-ok" style={{width:`${Math.min(100,((overview.totals.approved_requests||0)/Math.max(1,overview.totals.pending_requests+overview.totals.approved_requests+overview.totals.rejected_requests))*100)}%`}}/></div><span className="dash-bar-val">{overview.totals.approved_requests ?? 0}</span></div>
                  <div className="dash-bar-row"><span className="dash-bar-tag">已拒绝</span><div className="dash-bar-track"><div className="dash-bar-fill dash-bar-err" style={{width:`${Math.min(100,((overview.totals.rejected_requests||0)/Math.max(1,overview.totals.pending_requests+overview.totals.approved_requests+overview.totals.rejected_requests))*100)}%`}}/></div><span className="dash-bar-val">{overview.totals.rejected_requests ?? 0}</span></div>
                </div>
                <div className="admin-center-actions">
                  <Button size="small" fill="outline" loading={loading} onClick={() => void load()}>刷新</Button>
                </div>
              </SectionCard>
              <SectionCard title="缺货预警" subtitle="总库存低于安全库存的物料">
                {overview?.low_stock_items?.length ? (
                  <div className="tx-list">
                    {overview.low_stock_items.map((item) => (
                      <button key={item.id} type="button" className="catalog-row" onClick={() => navigate(`/purchase?material_id=${item.id}`)}>
                        <div className="catalog-row-main"><div className="catalog-row-name">{item.name}</div><div className="catalog-row-meta"><span className="chip">{item.code}</span>{item.supplier && <span className="chip chip-muted">{item.supplier}</span>}<span className="chip chip-muted">安全库存 {item.threshold}</span></div><div className="catalog-row-locs">{item.locations_summary ?? "暂无库存"}</div></div>
                        <div className="catalog-row-right"><span className="stock-badge stock-badge-warning">库存 {item.total_quantity}</span><span className="material-card-arrow">›</span></div>
                      </button>
                    ))}
                  </div>
                ) : <EmptyState icon="✅" text="暂无缺货预警" hint="所有物料库存均不低于安全库存" />}
              </SectionCard>
            </>
          )}
          {!overview && <EmptyState icon="⏳" text="加载中…" />}
        </Tabs.Tab>

        <Tabs.Tab title="运营概览" key="overview">
          <SectionCard title="实时汇总" subtitle="基于现有 Bitable、申请和流水数据">
            <div className="stat-grid">
              <StatCard label="库存总数" value={overview?.totals.inventory_quantity ?? "-"} unit="件" tone="primary" />
              <StatCard label="流水数" value={overview?.totals.transaction_count ?? "-"} unit="笔" />
              <StatCard label="入库数量" value={overview?.totals.inbound_quantity ?? "-"} unit="件" />
              <StatCard label="出库数量" value={overview?.totals.outbound_quantity ?? "-"} unit="件" tone="warning" />
              <StatCard label="待审批" value={overview?.totals.pending_requests ?? "-"} unit="条" tone="warning" />
              <StatCard label="缺货预警" value={overview?.totals.low_stock_count ?? "-"} unit="种" tone="warning" />
              <StatCard label="库存记录" value={overview?.totals.inventory_records ?? "-"} unit="条" />
            </div>
            <div className="admin-center-actions">
              <Button size="small" fill="outline" loading={loading} onClick={() => void load()}>刷新</Button>
            </div>
          </SectionCard>
          {overview && overview.recent_transactions && overview.recent_transactions.length > 0 && (
            <SectionCard title="最近操作">
              <div className="tx-list">
                {overview.recent_transactions.slice(0, 8).map((tx) => (
                  <div className="tx-item" key={tx.id}><TxBadge type={tx.type} /><div className="tx-main"><div className="tx-title">{tx.material_name ?? tx.material_id}</div><div className="tx-meta">{tx.operator} · {tx.location_name ?? "-"}</div></div><div className={`tx-qty ${tx.quantity>0?"tx-qty-in":"tx-qty-out"}`}>{tx.quantity>0?`+${tx.quantity}`:tx.quantity}</div></div>
                ))}
              </div>
            </SectionCard>
          )}
        </Tabs.Tab>

        <Tabs.Tab title="审计" key="audit">
          <SectionCard title="操作审计" subtitle="最近操作流水与角色判定状态">
            {audit?.recent_transactions.length ? (
              <div className="tx-list">
                {audit.recent_transactions.slice(0, 10).map((tx) => (
                  <div className="tx-item" key={tx.id}>
                    <TxBadge type={tx.type} />
                    <div className="tx-main">
                      <div className="tx-title">{tx.material_name ?? tx.material_id}</div>
                      <div className="tx-meta">{tx.operator} · {tx.location_name ?? tx.location_id} · {formatDate(tx.created_at)}</div>
                    </div>
                    <div className="tx-qty">{tx.quantity>0?`+${tx.quantity}`:tx.quantity}</div>
                    <Button size="mini" fill="none" onClick={() => openMenu("tx", tx)}>
                      <span className="material-symbols-outlined" style={{fontSize:18}}>more_vert</span>
                    </Button>
                  </div>
                ))}
              </div>
            ) : <EmptyState icon="📋" text="暂无审计流水" hint="出入库操作后会显示在这里" />}
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
    </Layout>
  );
}

export default function AdminCenterPage() {
  return (
    <AuthGate
      roles={["ADMIN"]}
      fallback={
        <Layout title="运营中心">
          <EmptyState icon="🔒" text="权限不足" hint="仅管理员可访问运营中心" />
        </Layout>
      }
    >
      <AdminCenterContent />
    </AuthGate>
  );
}
