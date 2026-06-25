import { useEffect, useMemo, useState } from "react";
import { Popup, Toast } from "antd-mobile";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { getMaterial, getMaterialTransactions } from "../api";
import type { InventoryItem, Location, MaterialDetail, Transaction } from "../api/types";
import { useAuth } from "../components/AuthGate";
import { DetailBottomActions, type DetailActionItem } from "../components/DetailBottomActions";
import { DetailLocationBlock } from "../components/DetailLocationBlock";
import { MaterialManagePanel } from "../components/MaterialManagePanel";
import { Layout } from "../components/Layout";
import { CardSkeleton, EmptyState, SectionCard, StatCard, TxBadge } from "../components/ui";
import { inventorySlotKey } from "../utils/inventoryDisplay";
import { fetchShelfMetaCached } from "../utils/cachedApi";
import {
  openStockForMaterial,
  readDetailNavState,
  resolveDetailBack,
} from "../utils/detailNavigation";
import { formatHistoryDate } from "../utils/historyDisplay";

export default function DetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const navState = readDetailNavState(location.state, id);
  const handleBack = () => resolveDetailBack(navigate, navState);
  const { canInbound, canApprove } = useAuth();
  const [detail, setDetail] = useState<MaterialDetail | null>(null);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [allInventory, setAllInventory] = useState<InventoryItem[]>([]);
  const [manageOpen, setManageOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  const reloadDetail = async () => {
    const [d, t, shelfMeta] = await Promise.all([
      getMaterial(id),
      getMaterialTransactions(id),
      fetchShelfMetaCached(),
    ]);
    setDetail(d);
    setTxs(t);
    setLocations(shelfMeta.locations);
    setAllInventory(shelfMeta.inventory);
  };

  useEffect(() => {
    if (!id) return;
    void reloadDetail().catch((e) => {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "加载失败" });
    });
  }, [id, location.key]);

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
    setAllInventory((current) =>
      current.map((item) =>
        item.material_id === updated.material_id && inventorySlotKey(item) === fromKey ? updated : item,
      ),
    );
  };

  const locationMap = useMemo(() => new Map(locations.map((loc) => [loc.id, loc])), [locations]);

  const bottomActions = useMemo((): DetailActionItem[] => {
    if (!detail) return [];

    const { material, total_quantity } = detail;
    const isEmpty = total_quantity <= 0;
    const preferInbound = isEmpty;
    const outboundLabel = canInbound ? "出库" : "申请出库";
    const inboundLabel = canInbound ? "入库" : "申请入库";

    const goStock = (tab: "outbound" | "inbound" | "transfer") => {
      openStockForMaterial(navigate, material.id, tab, navState);
    };

    const actions: DetailActionItem[] = [];

    if (!preferInbound) {
      actions.push({
        key: "outbound",
        label: outboundLabel,
        onClick: () => goStock("outbound"),
      });
    }

    actions.push({
      key: "inbound",
      label: inboundLabel,
      onClick: () => goStock("inbound"),
    });

    if (canInbound) {
      if (!preferInbound) {
        actions.push({
          key: "transfer",
          label: "移动",
          onClick: () => goStock("transfer"),
        });
      }
      if (canApprove) {
        actions.push({
          key: "purchase",
          label: "进货",
          onClick: () => {
            navigate(`/purchase?material_id=${material.id}`, {
              state: { materialBackTo: `/materials/${material.id}`, ...navState },
            });
          },
        });
      }
      actions.push({
        key: "manage",
        label: "维护",
        onClick: () => setManageOpen(true),
      });
    }

    if (preferInbound && !isEmpty) {
      actions.push({
        key: "outbound",
        label: outboundLabel,
        onClick: () => goStock("outbound"),
      });
    }

    return actions;
  }, [canApprove, canInbound, detail, navigate, navState]);

  if (!detail) {
    return (
      <Layout title="详情" onBack={handleBack}>
        <SectionCard>
          <CardSkeleton count={3} />
        </SectionCard>
      </Layout>
    );
  }

  const { material, inventory, total_quantity } = detail;
  const isLowStock = total_quantity < (material.min_stock ?? 5);
  const isEmpty = total_quantity <= 0;
  const recentTxs = txs.slice(0, 3);
  const categoryLabel = [material.major_category, material.sub_category ?? material.category_name]
    .filter(Boolean)
    .join(" / ");

  const goHistoryForMaterial = () => {
    const q = encodeURIComponent(material.name);
    navigate(`/history?q=${q}&view=transactions`);
  };

  return (
    <Layout title={material.name} onBack={handleBack}>
      <div className="detail-page-body">
        {navState.fromLabel && (
          <p className="detail-source-hint">来自 · {navState.fromLabel}</p>
        )}

        <div className="detail-hero">
          <div className="detail-summary-line">
            <span className="detail-summary-code">{material.code}</span>
            {categoryLabel && <span className="detail-summary-sep">·</span>}
            {categoryLabel && <span>{categoryLabel}</span>}
            {material.spec && (
              <>
                <span className="detail-summary-sep">·</span>
                <span>{material.spec}</span>
              </>
            )}
          </div>

          <div className="stat-grid stat-grid-compact">
            <StatCard
              label="库存"
              value={total_quantity}
              unit={material.unit}
              tone={isLowStock ? "warning" : "primary"}
            />
            <StatCard label="库位" value={inventory.length} unit="个" />
          </div>

          {isLowStock && (
            <div className="low-stock-alert">
              {isEmpty ? "当前无库存" : `低于安全库存 ${material.min_stock ?? 5}`}
            </div>
          )}
        </div>

        <SectionCard className="detail-info-card">
          <button type="button" className="collapse-trigger" onClick={() => setInfoOpen((v) => !v)}>
            更多资料 {infoOpen ? "▲" : "▼"}
          </button>
          {infoOpen && (
            <div className="detail-info-rows">
                <div className="info-row">
                  <span className="info-row-label">单位</span>
                  <span className="info-row-value">{material.unit}</span>
                </div>
                {material.supplier && (
                  <div className="info-row">
                    <span className="info-row-label">供货商</span>
                    <span className="info-row-value">{material.supplier}</span>
                  </div>
                )}
                {material.barcode && (
                  <div className="info-row">
                    <span className="info-row-label">条码</span>
                    <span className="info-row-value">{material.barcode}</span>
                  </div>
                )}
            </div>
          )}
        </SectionCard>

        <SectionCard title="库位库存" className="detail-inventory-card">
          {inventory.length === 0 ? (
            <EmptyState
              icon="tag"
              text="暂无库存"
              hint={canInbound ? "可点击下方「入库」上架" : "可提交入库申请"}
            />
          ) : (
            <div className="detail-loc-list">
              {inventory.map((inv) => {
                const loc = locationMap.get(inv.location_id);
                if (!loc) {
                  return (
                    <div key={inventorySlotKey(inv)} className="detail-loc-block detail-loc-block-fallback">
                      <p className="detail-loc-name">{inv.location_name ?? inv.location_id}</p>
                      <p className="detail-loc-meta-muted">{inv.quantity} 件 · 格位信息加载中</p>
                    </div>
                  );
                }
                return (
                  <DetailLocationBlock
                    key={inventorySlotKey(inv)}
                    location={loc}
                    materialId={material.id}
                    materialName={material.name}
                    item={inv}
                    locationInventory={allInventory.filter((row) => row.location_id === loc.id)}
                    canEdit={canInbound}
                    onUpdated={onInventoryUpdated}
                  />
                );
              })}
            </div>
          )}
        </SectionCard>

        {recentTxs.length > 0 && (
          <SectionCard
            title="最近流水"
            subtitle={txs.length > 3 ? `共 ${txs.length} 条` : undefined}
          >
            {recentTxs.map((tx) => (
              <button type="button" className="tx-item tx-item-clickable" key={tx.id} onClick={goHistoryForMaterial}>
                <TxBadge type={tx.type} />
                <div className="tx-main">
                  <div className="tx-title">{tx.location_name ?? tx.location_id}</div>
                  <div className="tx-meta">
                    {tx.operator} · {formatHistoryDate(tx.created_at)}
                  </div>
                </div>
                <div className="tx-qty">
                  {tx.quantity > 0 ? "+" : ""}
                  {tx.quantity}
                </div>
              </button>
            ))}
            {txs.length > 3 && (
              <button type="button" className="back-link" onClick={goHistoryForMaterial}>
                查看全部 →
              </button>
            )}
          </SectionCard>
        )}
      </div>

      <DetailBottomActions actions={bottomActions} />

      <Popup
        visible={manageOpen}
        onMaskClick={() => setManageOpen(false)}
        onClose={() => setManageOpen(false)}
        destroyOnClose
        showCloseButton
        bodyClassName="detail-manage-popup-body"
        bodyStyle={{
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          maxHeight: "min(88vh, 720px)",
          paddingBottom: "calc(16px + env(safe-area-inset-bottom, 0px))",
        }}
      >
        <div className="popup-panel detail-manage-panel">
          <div className="popup-panel-head">
            <strong>物料维护</strong>
            <span className="detail-manage-popup-sub">{material.code}</span>
          </div>
          <MaterialManagePanel
            embedded
            detail={detail}
            hasTransactions={txs.length > 0}
            onUpdated={(updated) => {
              setDetail((current) => (current ? { ...current, material: updated } : current));
              setManageOpen(false);
            }}
            onDeleted={() => {
              setManageOpen(false);
              resolveDetailBack(navigate, navState);
            }}
          />
        </div>
      </Popup>
    </Layout>
  );
}
