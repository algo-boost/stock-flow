import { useEffect, useState } from "react";
import { Button, DotLoading, Toast } from "antd-mobile";
import { useNavigate, useParams } from "react-router-dom";
import { getMaterial, getMaterialTransactions } from "../api";
import type { MaterialDetail, Transaction } from "../api/types";
import { useAuth } from "../components/AuthGate";
import { Layout } from "../components/Layout";
import { EmptyState, InfoRow, SectionCard, StatCard, TxBadge } from "../components/ui";

export default function DetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { canInbound } = useAuth();
  const [detail, setDetail] = useState<MaterialDetail | null>(null);
  const [txs, setTxs] = useState<Transaction[]>([]);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      try {
        const [d, t] = await Promise.all([getMaterial(id), getMaterialTransactions(id)]);
        setDetail(d);
        setTxs(t);
      } catch (e) {
        Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "加载失败" });
      }
    })();
  }, [id]);

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

  return (
    <Layout title={material.name}>
      <div className="stat-grid">
        <StatCard label="总库存" value={total_quantity} unit={material.unit} tone="primary" />
        <StatCard label="库位数" value={inventory.length} unit="个" />
      </div>

      <SectionCard title="基本信息">
        <InfoRow label="物料编码" value={material.code} />
        <InfoRow label="分类" value={material.category_name ?? "-"} />
        <InfoRow label="规格型号" value={material.spec ?? "-"} />
        <InfoRow label="单位" value={material.unit} />
        {material.barcode && <InfoRow label="条码" value={material.barcode} />}
      </SectionCard>

      <SectionCard title="各库位库存" subtitle="按库位查看可用数量">
        {inventory.length === 0 ? (
          <EmptyState icon="🏷️" text="暂无库存记录" />
        ) : (
          inventory.map((inv) => (
            <div className="location-card" key={inv.location_id}>
              <div className="location-name">{inv.location_name ?? inv.location_id}</div>
              <div className="location-qty">
                {inv.quantity} {material.unit}
              </div>
            </div>
          ))
        )}
      </SectionCard>

      <div className={`actions ${canInbound ? "" : "single"}`}>
        <Button color="primary" onClick={() => navigate(`/outbound?material_id=${material.id}`)}>
          出库领用
        </Button>
        {canInbound && (
          <>
            <Button fill="outline" onClick={() => navigate(`/inbound?material_id=${material.id}`)}>
              入库上架
            </Button>
            <Button fill="outline" onClick={() => navigate(`/transfer?material_id=${material.id}`)}>
              库内移动
            </Button>
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
