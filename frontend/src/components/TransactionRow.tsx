import { memo, useState } from "react";
import { ActionSheet, Button } from "antd-mobile";
import type { Transaction } from "../api/types";
import {
  formatHistoryDate,
  formatTxQuantity,
  parsePipeRemark,
} from "../utils/historyDisplay";
import { TxBadge } from "./ui";
import { FeishuIcon } from "./FeishuIcon";

export interface TransactionRowProps {
  tx: Transaction;
  onOpenMaterial: (materialId: string) => void;
  canEdit?: boolean;
  onEdit?: (tx: Transaction) => void;
  onDelete?: (tx: Transaction) => void;
}

function TransactionRowInner({
  tx,
  onOpenMaterial,
  canEdit,
  onEdit,
  onDelete,
}: TransactionRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const parsed = parsePipeRemark(tx.remark);
  return (
    <div className="tx-item">
      <TxBadge type={tx.type} />
      <div className="tx-main">
        <button
          type="button"
          className="history-link-title tx-title"
          onClick={() => onOpenMaterial(tx.material_id)}
        >
          {tx.material_name ?? tx.material_id} · {tx.location_name ?? tx.location_id}
        </button>
        <div className="tx-meta">
          {tx.operator} · {formatHistoryDate(tx.created_at)}
        </div>
        {parsed.note && <div className="tx-meta">说明：{parsed.note}</div>}
        {parsed.slot && <div className="tx-meta">格位：{parsed.slot}</div>}
        {parsed.returnPlan && <div className="tx-meta">归还：{parsed.returnPlan}</div>}
        {parsed.approver && parsed.approver !== tx.operator && (
          <div className="tx-meta">审批人：{parsed.approver}</div>
        )}
      </div>
      <div className={`tx-qty ${tx.type === "出库" ? "tx-qty-out" : tx.type === "入库" ? "tx-qty-in" : ""}`}>
        {formatTxQuantity(tx.type, tx.quantity)}
      </div>
      {canEdit && (onEdit || onDelete) && (
        <Button size="mini" fill="none" className="tx-menu-btn" onClick={() => setMenuOpen(true)}>
          <FeishuIcon name="more-vertical" size={18} />
        </Button>
      )}
      <ActionSheet
        visible={menuOpen}
        actions={[
          ...(onEdit ? [{ text: "纠错", key: "edit" }] : []),
          ...(onDelete && tx.type !== "移动" ? [{ text: "删除流水", key: "delete", danger: true }] : []),
        ]}
        cancelText="取消"
        onClose={() => setMenuOpen(false)}
        onAction={(action) => {
          setMenuOpen(false);
          if (action.key === "edit") onEdit?.(tx);
          if (action.key === "delete") onDelete?.(tx);
        }}
      />
    </div>
  );
}

export const TransactionRow = memo(TransactionRowInner);
