import { useEffect, useState } from "react";
import { Button, DotLoading, Toast } from "antd-mobile";
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
      <Layout title="物料详情">
        <SectionCard>
          <div className="empty">
            <DotLoading color="primary" />
            <div style={{ marginTop: 8 }}>加载中…</div>
          </div>
        </SectionCard>
      </Layout>
    );
  }

  const { material, inventory, total_quantity } = detail;
  const isLowStock = total_quantity < (material.min_stock ?? 5);

  return (
    <Layout title={material.name}>
      <div className="stat-grid">
        <StatCard label="总库存" value={total_quantity} unit={material.unit} tone={isLowStock ? "warning" : "primary"} />
        <StatCard label="库位数" value={inventory.length} unit="个" />
        <StatCard label="安全库存" value={material.min_stock ?? 5} unit={material.unit} tone={isLowStock ? "warning" : "default"} />
      </div>
      {isLowStock && (
        <div className="low-stock-alert">
          缺货预警：当前库存低于安全库存 {material.min_stock ?? 5}，管理员可从进货入口补货。
        </div>
      )}

      <SectionCard title="基本信息">
        <InfoRow label="物料编码" value={material.code} />
        <InfoRow label="大类" value={material.major_category ?? "-"} />
        <InfoRow label="子类" value={material.sub_category ?? material.category_name ?? "-"} />
        <InfoRow label="规格型号" value={material.spec ?? "-"} />
        <InfoRow label="单位" value={material.unit} />
        <InfoRow label="供货商" value={material.supplier ?? "-"} />
        <InfoRow label="安全库存" value={material.min_stock ?? 5} />
        {material.barcode && <InfoRow label="条码" value={material.barcode} />}
      </SectionCard>

      {canInbound && (
        <MaterialManagePanel
          detail={detail}
          hasTransactions={txs.length > 0}
          onUpdated={(updated) =>
            setDetail((current) => (current ? { ...current, material: updated } : current))
          }
          onDeleted={() => navigate(-1)}
        />
      )}

      <SectionCard title="各库位库存" subtitle="货柜类库位可设置第几行、第几列；手机端数据旧时可点下方刷新缓存">
        {canInbound && (
          <div style={{ marginBottom: 12 }}>
            <CacheRefreshButton onRefreshed={reloadDetail} />
          </div>
        )}
        {inventory.length === 0 ? (
          <EmptyState icon="🏷️" text="暂无库存记录" />
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

      <div className={`actions ${canInbound ? "" : "single"}`}>
        <Button color="primary" onClick={() => navigate(`/stock?material_id=${material.id}`)}>
          {canInbound ? "出库领用" : "出库申请"}
        </Button>
        {canInbound && (
          <>
            <Button fill="outline" onClick={() => navigate(`/stock?tab=inbound&material_id=${material.id}`)}>
              入库上架
            </Button>
            <Button fill="outline" onClick={() => navigate(`/locations?tab=transfer&material_id=${material.id}`)}>
              库内移动
            </Button>
            {canApprove && (
              <Button fill="outline" onClick={() => navigate(`/purchase?material_id=${material.id}`)}>
                进货补货
              </Button>
            )}
          </>
        )}
      </div>

      <SectionCard title="最近流水" subtitle="出入库与库内移动追溯">
        {txs.length === 0 ? (
          <EmptyState icon="📒" text="暂无流水" hint="完成出入库后会显示在这里" />
        ) : (
          txs.map((tx) => (
            <div className="tx-item" key={tx.id}>
              <TxBadge type={tx.type} />
              <div className="tx-main">
                <div className="tx-title">{tx.location_name ?? tx.location_id}</div>
                <div className="tx-meta">
                  {tx.operator} · {new Date(tx.created_at).toLocaleString()}
                  {tx.remark ? ` · ${tx.remark}` : ""}
                </div>
              </div>
              <div className="tx-qty">
                {tx.quantity > 0 ? "+" : ""}
                {tx.quantity}
              </div>
            </div>
          ))
        )}
      </SectionCard>
    </Layout>
  );
}
