import { useEffect, useState } from "react";
import { Button, Stepper, Toast } from "antd-mobile";
import { updateInventorySlot } from "../api";
import type { InventoryItem } from "../api/types";
import { formatInventorySlot, inventorySlotKey } from "../utils/inventoryDisplay";

export function InventorySlotEditor({
  materialId,
  item,
  canEdit,
  onUpdated,
  variant = "card",
}: {
  materialId: string;
  item: InventoryItem;
  canEdit: boolean;
  onUpdated: (item: InventoryItem, fromKey: string) => void;
  variant?: "card" | "inline" | "keeper-correction";
}) {
  const [editing, setEditing] = useState(false);
  const [row, setRow] = useState(item.row ?? 1);
  const [column, setColumn] = useState(item.column ?? 1);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setRow(item.row ?? 1);
    setColumn(item.column ?? 1);
  }, [item.row, item.column]);

  const hasSlot = item.row != null && item.column != null;
  const hasRowOnly = item.row != null && item.column == null;

  const onSave = async () => {
    const fromKey = inventorySlotKey(item);
    setSaving(true);
    try {
      const updated = await updateInventorySlot(materialId, item.location_id, {
        row,
        column,
        from_row: item.row ?? undefined,
        from_column: item.column ?? undefined,
      });
      Toast.show({ icon: "success", content: "格位已更新" });
      onUpdated(updated, fromKey);
      setEditing(false);
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "更新格位失败" });
    } finally {
      setSaving(false);
    }
  };

  if (variant === "keeper-correction") {
    if (!canEdit) return null;
    return (
      <div className="detail-slot-correction">
        {!editing ? (
          <button type="button" className="detail-slot-correction-toggle" onClick={() => setEditing(true)}>
            格位标注纠错
          </button>
        ) : (
          <div className="inventory-slot-editor detail-loc-slot-editor">
            <div className="inventory-slot-field">
              <span>层</span>
              <Stepper min={1} max={20} value={row} onChange={setRow} />
            </div>
            <div className="inventory-slot-field">
              <span>列</span>
              <Stepper min={1} max={20} value={column} onChange={setColumn} />
            </div>
            <div className="actions two">
              <Button size="small" onClick={() => setEditing(false)}>
                取消
              </Button>
              <Button size="small" color="primary" loading={saving} onClick={() => void onSave()}>
                保存
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (variant === "inline") {
    return (
      <div className="detail-loc-head">
        <div className="detail-loc-head-main">
          <div className="detail-loc-name">{item.location_name ?? item.location_id}</div>
          <div className="detail-loc-meta">
            {hasSlot ? (
              <span>{item.row} 层 · {item.column} 列</span>
            ) : hasRowOnly ? (
              <span>第 {item.row} 层</span>
            ) : (
              <span className="detail-loc-meta-muted">格位未设置</span>
            )}
          </div>
        </div>
        <div className="detail-loc-head-side">
          <span className="detail-loc-qty">{item.quantity} 件</span>
          {canEdit && !editing && (
            <button type="button" className="detail-loc-edit-btn" onClick={() => setEditing(true)}>
              {hasSlot || hasRowOnly ? "改格位" : "设格位"}
            </button>
          )}
        </div>
        {canEdit && editing && (
          <div className="inventory-slot-editor detail-loc-slot-editor">
            <div className="inventory-slot-field">
              <span>行</span>
              <Stepper min={1} max={20} value={row} onChange={setRow} />
            </div>
            <div className="inventory-slot-field">
              <span>列</span>
              <Stepper min={1} max={20} value={column} onChange={setColumn} />
            </div>
            <div className="actions two">
              <Button size="small" onClick={() => setEditing(false)}>
                取消
              </Button>
              <Button size="small" color="primary" loading={saving} onClick={() => void onSave()}>
                保存
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="location-card location-inventory-card">
      <div className="location-card-main">
        <div className="location-name">{formatInventorySlot(item, false)}</div>
        <div className="location-meta">
          {hasSlot ? (
            <span className="chip chip-primary">
              第 {item.row} 行 · 第 {item.column} 列
            </span>
          ) : (
            <span className="chip chip-muted">格位未设置</span>
          )}
        </div>
      </div>
      <div className="location-card-actions location-inventory-actions">
        <span className="stock-badge">
          {item.quantity} 件
        </span>
        {canEdit && !editing && (
          <Button size="mini" fill="outline" onClick={() => setEditing(true)}>
            {hasSlot ? "改格位" : "设格位"}
          </Button>
        )}
      </div>
      {canEdit && editing && (
        <div className="inventory-slot-editor">
          <div className="inventory-slot-field">
            <span>行</span>
            <Stepper min={1} max={20} value={row} onChange={setRow} />
          </div>
          <div className="inventory-slot-field">
            <span>列</span>
            <Stepper min={1} max={20} value={column} onChange={setColumn} />
          </div>
          <div className="actions two">
            <Button size="small" onClick={() => setEditing(false)}>
              取消
            </Button>
            <Button size="small" color="primary" loading={saving} onClick={() => void onSave()}>
              保存
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
