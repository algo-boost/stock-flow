import { useCallback, useMemo, useState } from "react";
import { Button, Dialog, Form, Selector, Stepper, TextArea, Toast } from "antd-mobile";
import { listStagingInventory, listLocations, postTransfer } from "../api";
import type { Location, StagingInventoryItem } from "../api/types";
import { formatStagingLocationLine, inventorySlotKey } from "../utils/inventoryDisplay";
import { buildSlotPayload, type SlotSelection } from "../utils/inventorySlot";
import { isGridCapableLocation } from "../utils/shelfGrid";
import { showUndo } from "./UndoToast";
import { useLiveListData } from "../utils/dataMutation";
import { EmptyState, SectionCard, StockFormShell } from "./ui";
import { newIdempotencyKey } from "../utils/idempotency";
import { emptySlotSelection, LocationSlotPicker } from "./LocationSlotPicker";

function isFormalLocation(loc: Location, stagingIds: Set<string>) {
  return !stagingIds.has(loc.id);
}

export function StagingShelvePanel({ active = true }: { active?: boolean }) {
  const [items, setItems] = useState<StagingInventoryItem[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<StagingInventoryItem | null>(null);
  const [toLocationId, setToLocationId] = useState("");
  const [toSlotSelection, setToSlotSelection] = useState<SlotSelection>(emptySlotSelection());
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const stagingIds = useMemo(
    () =>
      new Set(
        locations
          .filter(
            (loc) =>
              (loc.type ?? "").includes("暂存") ||
              (loc.name ?? "").includes("暂存") ||
              (loc.major_name ?? "").includes("暂存"),
          )
          .map((loc) => loc.id),
      ),
    [locations],
  );

  const targetOptions = useMemo(
    () =>
      locations
        .filter((loc) => isFormalLocation(loc, stagingIds))
        .map((loc) => ({
          label: `${loc.name}（${loc.code}）`,
          value: loc.id,
        })),
    [locations, stagingIds],
  );

  const selectedTarget = locations.find((loc) => loc.id === toLocationId);
  const showTargetGridSlot = Boolean(selectedTarget && isGridCapableLocation(selectedTarget));
  const toSlotPayload = buildSlotPayload(selectedTarget, [], toSlotSelection);
  const maxQty = selected?.quantity ?? 0;
  const canSubmit = Boolean(
    selected &&
      toLocationId &&
      qty > 0 &&
      qty <= maxQty &&
      selected.location_id !== toLocationId &&
      (!showTargetGridSlot || Object.keys(toSlotPayload).length > 0),
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [stagingItems, locs] = await Promise.all([listStagingInventory(), listLocations()]);
      setItems(stagingItems);
      setLocations(locs);
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "加载暂存库存失败" });
    } finally {
      setLoading(false);
    }
  }, []);

  useLiveListData(load, { scopes: ["locations", "inventory"], active });

  const openItem = (item: StagingInventoryItem) => {
    setSelected(item);
    setQty(Math.min(item.quantity, 1) || 1);
    setToLocationId(targetOptions[0]?.value ?? "");
    setToSlotSelection(emptySlotSelection());
    setNote("");
  };

  const backToList = () => {
    setSelected(null);
    setToLocationId("");
    setQty(1);
    setNote("");
  };

  const onSubmit = async () => {
    if (!selected || !canSubmit) {
      Toast.show({ content: "请填写完整上架信息" });
      return;
    }
    const toLabel = selectedTarget?.name ?? toLocationId;
    const confirmed = await Dialog.confirm({
      title: "确认暂存上架",
      content: `${selected.material_name ?? selected.material_id}\n从：${selected.location_name}\n至：${toLabel}\n数量：${qty}`,
      confirmText: "确认上架",
    });
    if (!confirmed) return;

    setSubmitting(true);
    try {
      const payload = {
        material_id: selected.material_id,
        from_location_id: selected.location_id,
        to_location_id: toLocationId,
        qty,
        idempotency_key: newIdempotencyKey(),
        note: note.trim() || undefined,
        from_row: selected.row ?? undefined,
        from_column: selected.column ?? undefined,
        to_row: toSlotPayload.row,
        to_column: toSlotPayload.column,
      };
      await postTransfer(payload);
      showUndo(`${selected.material_name ?? "物料"} 已上架 ${qty} 件`, async () => {
        await postTransfer({
          material_id: payload.material_id,
          from_location_id: payload.to_location_id,
          to_location_id: payload.from_location_id,
          qty,
          idempotency_key: newIdempotencyKey(),
          note: "撤销暂存上架",
          from_row: payload.to_row,
          from_column: payload.to_column,
          to_row: payload.from_row,
          to_column: payload.from_column,
        });
        Toast.show({ icon: "success", content: "已撤销" });
        void load();
      });
      Toast.show({ icon: "success", content: "上架成功" });
      backToList();
      void load();
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "上架失败" });
    } finally {
      setSubmitting(false);
    }
  };

  if (selected) {
    return (
      <StockFormShell
        action={
          <Button color="primary" loading={submitting} disabled={!canSubmit} onClick={() => void onSubmit()}>
            确认上架
          </Button>
        }
      >
        <SectionCard
          title="暂存上架"
          subtitle={`${selected.material_name ?? selected.material_id}`}
        >
          <button type="button" className="back-link" onClick={backToList}>
            ← 返回列表
          </button>
          <div className="staging-source-bar">
            <div className="staging-source-main">
              <span className="staging-source-name">{selected.material_name}</span>
              {selected.material_code && (
                <span className="staging-source-code">{selected.material_code}</span>
              )}
            </div>
            <div className="staging-source-side">
              <span className="staging-source-qty">{selected.quantity} {selected.unit ?? "件"}</span>
              <span className="staging-source-loc">{formatStagingLocationLine(selected)}</span>
            </div>
          </div>
          <Form layout="vertical" className="form-card">
            <Form.Item label="目标库位">
              <Selector
                options={targetOptions}
                value={toLocationId ? [toLocationId] : []}
                onChange={(arr) => {
                  setToLocationId(arr[0] ?? "");
                  setToSlotSelection(emptySlotSelection());
                }}
              />
            </Form.Item>
            {showTargetGridSlot && selectedTarget && (
              <LocationSlotPicker
                location={selectedTarget}
                materialId={selected.material_id}
                value={toSlotSelection}
                onChange={setToSlotSelection}
              />
            )}
            <Form.Item label="上架数量">
              <Stepper min={1} max={maxQty} value={qty} onChange={setQty} />
            </Form.Item>
            <Form.Item label="备注（可选）">
              <TextArea value={note} onChange={setNote} placeholder="可选" rows={2} />
            </Form.Item>
          </Form>
        </SectionCard>
      </StockFormShell>
    );
  }

  return (
    <SectionCard
      title="待上架"
      subtitle={loading ? "加载中…" : items.length > 0 ? `${items.length} 件物料在暂存区` : undefined}
    >
      {items.length === 0 ? (
        <EmptyState
          loading={loading}
          icon="inbox"
          text={loading ? "加载中…" : "暂存区暂无库存"}
          hint="快递到货请先入库到「快递暂存」库位，拆包后再在此上架"
        />
      ) : (
        <div className="catalog-list staging-catalog-list">
          {items.map((item) => (
            <button
              type="button"
              className="catalog-row"
              key={inventorySlotKey(item)}
              onClick={() => openItem(item)}
            >
              <div className="catalog-row-main">
                <div className="catalog-row-name">{item.material_name ?? item.material_id}</div>
                <div className="catalog-row-meta">
                  {item.material_code && <span className="chip">{item.material_code}</span>}
                  <span className="chip chip-muted">{formatStagingLocationLine(item)}</span>
                </div>
              </div>
              <div className="catalog-row-right">
                <span className="stock-badge">{item.quantity} {item.unit ?? "件"}</span>
                <span className="material-card-arrow">›</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
