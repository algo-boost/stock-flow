import { useEffect, useState } from "react";
import { ActionSheet, Button, Popup, Toast } from "antd-mobile";
import type { Action } from "antd-mobile/es/components/action-sheet";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { getMaterial, getMaterialTransactions } from "../api";
import type { InventoryItem, MaterialDetail, Transaction } from "../api/types";
import { useAuth } from "../components/AuthGate";
import { InventorySlotEditor } from "../components/InventorySlotEditor";
import { MaterialManagePanel } from "../components/MaterialManagePanel";
import { Layout } from "../components/Layout";
import { CardSkeleton, EmptyState, SectionCard, StatCard, TxBadge } from "../components/ui";
import { inventorySlotKey } from "../utils/inventoryDisplay";
import {
  openStockForMaterial,
  readDetailNavState,
  resolveDetailBack,
  type DetailNavState,
  type ShelfNavState,
} from "../utils/detailNavigation";
import { formatHistoryDate } from "../utils/historyDisplay";

export default function DetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const navState = readDetailNavState(location.state);
  const handleBack = () => resolveDetailBack(navigate, navState);
  const { canInbound, canApprove } = useAuth();
  const [detail, setDetail] = useState<MaterialDetail | null>(null);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
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
  };

  const openShelf = (inv: InventoryItem) => {
    const params = new URLSearchParams();
    if (inv.row != null && inv.row > 0) params.set("row", String(inv.row));
    if (inv.column != null) params.set("column", String(inv.column));
    const qs = params.toString();
    const slotLabel = [
      inv.location_name ?? inv.location_id,
      inv.row != null && inv.column != null ? `${inv.row}层${inv.column}格` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    navigate(`/shelves/${inv.location_id}${qs ? `?${qs}` : ""}`, {
      state: {
        backTo: `/materials/${material.id}`,
        backState: {
          backTo: navState.backTo,
          backState: navState.backState,
          fromLabel: navState.fromLabel,
        },
        fromLabel: slotLabel,
      } satisfies ShelfNavState & DetailNavState,
    });
  };

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
  const preferInbound = isLowStock || isEmpty;
  const recentTxs = txs.slice(0, 3);
  const categoryLabel = [material.major_category, material.sub_category ?? material.category_name]
    .filter(Boolean)
    .join(" / ");

  const actionItems: Action[] = [
    ...(preferInbound
      ? []
      : [
          {
            text: canInbound ? "出库" : "申请出库",
            key: "outbound",
          },
        ]),
    {
      text: canInbound ? "入库" : "申请入库",
      key: "inbound",
    },
    ...(canInbound
      ? [
          { text: "移动", key: "transfer" },
          ...(canApprove ? [{ text: "进货", key: "purchase" }] : []),
          { text: "维护物料资料", key: "manage" },
        ]
      : []),
    ...(preferInbound && canInbound
      ? [{ text: "仍要出库", key: "outbound" }]
      : preferInbound && !canInbound
        ? [{ text: "申请出库", key: "outbound" }]
        : []),
  ];

  const onAction = (action: Action) => {
    setActionsOpen(false);
    const mid = material.id;
    const ctx = navState;
    switch (action.key) {
      case "outbound":
        openStockForMaterial(navigate, mid, "outbound", ctx);
        break;
      case "inbound":
        openStockForMaterial(navigate, mid, "inbound", ctx);
        break;
      case "transfer":
        openStockForMaterial(navigate, mid, "transfer", ctx);
        break;
      case "purchase":
        navigate(`/purchase?material_id=${mid}`, {
          state: { materialBackTo: `/materials/${mid}`, ...ctx },
        });
        break;
      case "manage":
        setManageOpen(true);
        break;
    }
  };

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
          <StatCard label="库存" value={total_quantity} unit={material.unit} tone={isLowStock ? "warning" : "primary"} />
          <StatCard label="库位" value={inventory.length} unit="个" />
        </div>
        {isLowStock && (
          <div className="low-stock-alert">
            {isEmpty ? "当前无库存" : `低于安全库存 ${material.min_stock ?? 5}`}
          </div>
        )}

        <SectionCard>
          <button type="button" className="collapse-trigger" onClick={() => setInfoOpen((v) => !v)}>
            更多资料 {infoOpen ? "▲" : "▼"}
          </button>
          {infoOpen && (
            <>
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
            </>
          )}
        </SectionCard>

        <SectionCard title="库位库存">
          {inventory.length === 0 ? (
            <EmptyState
              icon="🏷️"
              text="暂无库存"
              hint={canInbound ? "可点击下方「入库」上架" : "可提交入库申请"}
            />
          ) : (
            inventory.map((inv) => (
              <div
                key={inventorySlotKey(inv)}
                className="detail-inventory-row"
                role="button"
                tabIndex={0}
                onClick={() => openShelf(inv)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openShelf(inv);
                  }
                }}
              >
                <div className="detail-inventory-editor" onClick={(e) => e.stopPropagation()}>
                  <InventorySlotEditor
                    materialId={material.id}
                    item={inv}
                    canEdit={canInbound}
                    onUpdated={onInventoryUpdated}
                  />
                </div>
                <span className="detail-shelf-link">格位图 ›</span>
              </div>
            ))
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

      <div className="detail-bottom-bar">
        {preferInbound ? (
          <>
            <Button
              color="primary"
              className="detail-bottom-primary"
              onClick={() => openStockForMaterial(navigate, material.id, "inbound", navState)}
            >
              {canInbound ? "入库" : "申请入库"}
            </Button>
            <Button
              fill="outline"
              disabled={isEmpty && canInbound}
              onClick={() => openStockForMaterial(navigate, material.id, "outbound", navState)}
            >
              {canInbound ? "出库" : "申请出库"}
            </Button>
            {canInbound && (
              <Button fill="outline" onClick={() => setActionsOpen(true)}>
                更多
              </Button>
            )}
          </>
        ) : (
          <>
            <Button
              color="primary"
              className="detail-bottom-primary"
              onClick={() => openStockForMaterial(navigate, material.id, "outbound", navState)}
            >
              {canInbound ? "出库" : "申请出库"}
            </Button>
            <Button fill="outline" onClick={() => setActionsOpen(true)}>
              更多
            </Button>
          </>
        )}
      </div>

      <ActionSheet
        visible={actionsOpen}
        actions={actionItems}
        onClose={() => setActionsOpen(false)}
        onAction={onAction}
        cancelText="取消"
      />

      <Popup
        visible={manageOpen}
        onMaskClick={() => setManageOpen(false)}
        bodyStyle={{ borderTopLeftRadius: 12, borderTopRightRadius: 12, maxHeight: "85vh", overflow: "auto" }}
      >
        <div className="popup-panel">
          <MaterialManagePanel
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
          <Button block fill="outline" onClick={() => setManageOpen(false)}>
            关闭
          </Button>
        </div>
      </Popup>
    </Layout>
  );
}
