import { useEffect, useState } from "react";
import { ActionSheet, Button, DotLoading, Toast } from "antd-mobile";
import type { Action } from "antd-mobile/es/components/action-sheet";
import { useNavigate, useParams } from "react-router-dom";
import { getMaterial, getMaterialTransactions } from "../api";
import type { InventoryItem, MaterialDetail, Transaction } from "../api/types";
import { useAuth } from "../components/AuthGate";
import { InventorySlotEditor } from "../components/InventorySlotEditor";
import { CacheRefreshButton } from "../components/CacheRefreshButton";
import { MaterialManagePanel } from "../components/MaterialManagePanel";
import { Layout } from "../components/Layout";
import { EmptyState, InfoRow, SectionCard, StatCard, TxBadge } from "../components/ui";
import { inventorySlotKey } from "../utils/inventoryDisplay";

export default function DetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { canInbound, canApprove } = useAuth();
  const [detail, setDetail] = useState<MaterialDetail | null>(null);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  const reloadDetail = async () => {
    const [d, t] = await Promise.all([getMaterial(id), getMaterialTransactions(id)]);
    setDetail(d);
    setTxs(t);
  };

  useEffect(() => {
    if (!id) return;
    void reloadDetail().catch((e) => {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "加载失败" });
    });
  }, [id]);

  const onInventoryUpdated = (updated: InventoryItem, fromKey: string) => {
    setDetail((current) => {
      if (!current) return current;
      let replaced = false;
      const inventory = current.inventory.map((item) => {
        if (inventorySlotKey(item) !== fromKey) return item;
        replaced = true;
        return updated;
      });
      if (!replaced) {
        void reloadDetail();
        return current;
      }
      return { ...current, inventory };
    });
  };

  if (!detail) {
    return (
      <Layout title="详情">
        <SectionCard>
          <div className="empty">
            <DotLoading color="primary" />
          </div>
        </SectionCard>
      </Layout>
    );
  }

  const { material, inventory, total_quantity } = detail;
  const isLowStock = total_quantity < (material.min_stock ?? 5);
  const recentTxs = txs.slice(0, 3);

  const actionItems: Action[] = [
    { text: canInbound ? "出库" : "申请出库", key: "outbound" },
    ...(canInbound
      ? [
          { text: "入库", key: "inbound" },
          { text: "移动", key: "transfer" },
          ...(canApprove ? [{ text: "进货", key: "purchase" }] : []),
        ]
      : [{ text: "申请入库", key: "inbound" }]),
  ];

  const onAction = (action: Action) => {
    setActionsOpen(false);
    const mid = material.id;
    switch (action.key) {
      case "outbound":
        navigate(`/stock?material_id=${mid}`);
        break;
      case "inbound":
        navigate(`/stock?tab=inbound&material_id=${mid}`);
        break;
      case "transfer":
        navigate(`/stock?tab=transfer&material_id=${mid}`);
        break;
      case "purchase":
        navigate(`/purchase?material_id=${mid}`);
        break;
    }
  };

  return (
    <Layout title={material.name}>
      <div className="stat-grid stat-grid-compact">
        <StatCard label="库存" value={total_quantity} unit={material.unit} tone={isLowStock ? "warning" : "primary"} />
        <StatCard label="库位" value={inventory.length} unit="个" />
      </div>
      {isLowStock && <div className="low-stock-alert">低于安全库存 {material.min_stock ?? 5}</div>}

      <div className="detail-actions-bar">
        <Button color="primary" size="small" onClick={() => setActionsOpen(true)}>
          操作
        </Button>
        <Button size="small" fill="outline" onClick={() => navigate(`/history`)}>
          流水
        </Button>
      </div>

      <ActionSheet visible={actionsOpen} actions={actionItems} onClose={() => setActionsOpen(false)} onAction={onAction} cancelText="取消" />

      <SectionCard>
        <button type="button" className="collapse-trigger" onClick={() => setInfoOpen((v) => !v)}>
          基本信息 {infoOpen ? "▲" : "▼"}
        </button>
        {infoOpen && (
          <>
            <InfoRow label="编码" value={material.code} />
            <InfoRow label="分类" value={[material.major_category, material.sub_category ?? material.category_name].filter(Boolean).join(" / ") || "-"} />
            <InfoRow label="规格" value={material.spec ?? "-"} />
            <InfoRow label="单位" value={material.unit} />
            {material.supplier && <InfoRow label="供货商" value={material.supplier} />}
          </>
        )}
      </SectionCard>

      {canInbound && (
        <MaterialManagePanel
          detail={detail}
          hasTransactions={txs.length > 0}
          onUpdated={(updated) => setDetail((current) => (current ? { ...current, material: updated } : current))}
          onDeleted={() => navigate(-1)}
        />
      )}

      <SectionCard title="库位库存">
        {canInbound && (
          <div className="panel-toolbar">
            <CacheRefreshButton onRefreshed={reloadDetail} />
          </div>
        )}
        {inventory.length === 0 ? (
          <EmptyState icon="🏷️" text="暂无库存" />
        ) : (
          inventory.map((inv) => (
            <InventorySlotEditor
              key={inventorySlotKey(inv)}
              materialId={material.id}
              item={inv}
              canEdit={canInbound}
              onUpdated={onInventoryUpdated}
            />
          ))
        )}
      </SectionCard>

      {recentTxs.length > 0 && (
        <SectionCard
          title="最近流水"
          subtitle={txs.length > 3 ? `共 ${txs.length} 条` : undefined}
        >
          {recentTxs.map((tx) => (
            <div className="tx-item" key={tx.id}>
              <TxBadge type={tx.type} />
              <div className="tx-main">
                <div className="tx-title">{tx.location_name ?? tx.location_id}</div>
                <div className="tx-meta">{tx.operator}</div>
              </div>
              <div className="tx-qty">
                {tx.quantity > 0 ? "+" : ""}
                {tx.quantity}
              </div>
            </div>
          ))}
          {txs.length > 3 && (
            <button type="button" className="back-link" onClick={() => navigate("/history")}>
              查看全部 →
            </button>
          )}
        </SectionCard>
      )}
    </Layout>
  );
}
