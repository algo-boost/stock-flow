import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Dialog, Form, SearchBar, Selector, Stepper, TextArea, Toast } from "antd-mobile";
import { useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { getMaterial, listLocations, postTransfer, searchMaterials } from "../api";
import type { Location, MaterialDetail, MaterialSearchItem } from "../api/types";
import {
  findInventoryBySlotKey,
  formatInventorySlot,
  inventorySlotKey,
  parseInventorySlotKey,
} from "../utils/inventoryDisplay";
import { showUndo } from "./UndoToast";
import {
  detailContextAfterStock,
  openMaterialDetail,
  readStockNavState,
} from "../utils/detailNavigation";
import { EmptyState, SectionCard } from "./ui";

function newIdempotencyKey() {
  return crypto.randomUUID();
}

export function LocationTransferPanel() {
  const pageSize = 20;
  const navigate = useNavigate();
  const location = useLocation();
  const stockState = readStockNavState(location.state);
  const [params] = useSearchParams();
  const presetMaterialId = params.get("material_id") ?? "";
  const [items, setItems] = useState<MaterialSearchItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [selected, setSelected] = useState<MaterialDetail | null>(null);
  const [fromSlotKey, setFromSlotKey] = useState("");
  const [toLocationId, setToLocationId] = useState("");
  const [toSlotRow, setToSlotRow] = useState(1);
  const [toSlotColumn, setToSlotColumn] = useState(1);
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loadMaterials = useCallback(async (q = "", nextPage = 1, append = false) => {
    setLoading(true);
    try {
      const data = await searchMaterials(q, { page: nextPage, size: pageSize, stockOnly: true });
      setItems((current) => (append ? [...current, ...data.items] : data.items));
      setPage(data.page);
      setTotal(data.total);
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "加载 Bitable 数据失败" });
    } finally {
      setLoading(false);
    }
  }, []);

  const loadLocations = useCallback(async () => {
    try {
      setLocations(await listLocations());
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "加载库位失败" });
    }
  }, []);

  useEffect(() => {
    void loadMaterials("", 1);
    void loadLocations();
  }, [loadLocations, loadMaterials]);

  useEffect(() => {
    if (!presetMaterialId) return;
    void (async () => {
      try {
        const detail = await getMaterial(presetMaterialId);
        setSelected(detail);
        const first = detail.inventory[0];
        setFromSlotKey(first ? inventorySlotKey(first) : "");
        setToLocationId(locations.find((loc) => loc.id !== first?.location_id)?.id ?? "");
        setToSlotRow(1);
        setToSlotColumn(1);
      } catch (e) {
        Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "加载物料失败" });
      }
    })();
  }, [locations, presetMaterialId]);

  const locationOptions = useMemo(
    () =>
      locations.map((loc) => ({
        label: `${loc.name}（${loc.code}）`,
        value: loc.id,
      })),
    [locations],
  );

  const sourceOptions = useMemo(
    () =>
      (selected?.inventory ?? []).map((inv) => ({
        label: `${formatInventorySlot(inv)}（可用 ${inv.quantity}）`,
        value: inventorySlotKey(inv),
      })),
    [selected],
  );

  const fromParsed = parseInventorySlotKey(fromSlotKey);
  const selectedSource = selected ? findInventoryBySlotKey(selected.inventory, fromSlotKey) : undefined;
  const selectedToLocation = useMemo(
    () => locations.find((loc) => loc.id === toLocationId),
    [locations, toLocationId],
  );
  const showTargetCabinetSlot = selectedToLocation?.type === "货柜";
  const maxQty = selectedSource?.quantity ?? 0;
  const canSubmit = Boolean(
    selected &&
      fromSlotKey &&
      toLocationId &&
      fromParsed.location_id !== toLocationId &&
      qty > 0 &&
      qty <= maxQty,
  );

  const selectMaterial = async (item: MaterialSearchItem) => {
    setLoading(true);
    try {
      const detail = await getMaterial(item.id);
      const first = detail.inventory[0];
      setSelected(detail);
      setFromSlotKey(first ? inventorySlotKey(first) : "");
      setToLocationId(locations.find((loc) => loc.id !== first?.location_id)?.id ?? "");
      setToSlotRow(1);
      setToSlotColumn(1);
      setQty(1);
      setNote("");
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "加载物料失败" });
    } finally {
      setLoading(false);
    }
  };

  const onSearch = (val: string) => {
    setKeyword(val);
    void loadMaterials(val, 1);
  };

  const loadMore = () => {
    void loadMaterials(keyword, page + 1, true);
  };

  const hasMore = items.length < total;

  const backToList = () => {
    setSelected(null);
    setFromSlotKey("");
    setToLocationId("");
    setToSlotRow(1);
    setToSlotColumn(1);
    setQty(1);
    setNote("");
  };

  const onSubmit = async () => {
    if (!selected || !canSubmit) {
      Toast.show({ content: "请填写完整移动信息" });
      return;
    }

    const fromLabel = selectedSource ? formatInventorySlot(selectedSource, false) : fromParsed.location_id;
    const toLabel = selectedToLocation?.name ?? toLocationId;
    const confirmed = await Dialog.confirm({
      title: qty >= 10 ? "确认大批量移动" : "确认移动",
      content: `${selected.material.name}\n从：${fromLabel}\n至：${toLabel}\n数量：${qty} ${selected.material.unit}`,
      confirmText: "确认移动",
      cancelText: "取消",
    });
    if (!confirmed) return;

    setSubmitting(true);
    try {
      const payload = {
        material_id: selected.material.id,
        from_location_id: fromParsed.location_id,
        to_location_id: toLocationId,
        qty,
        idempotency_key: newIdempotencyKey(),
        note: note.trim() || undefined,
        from_row: fromParsed.row,
        from_column: fromParsed.column,
        to_row: showTargetCabinetSlot ? toSlotRow : undefined,
        to_column: showTargetCabinetSlot ? toSlotColumn : undefined,
      };
      await postTransfer(payload);
      const materialName = selected.material.name;
      const undoQty = qty;
      showUndo(`${materialName} 已移动 ${undoQty} 件`, async () => {
        await postTransfer({
          material_id: payload.material_id,
          from_location_id: payload.to_location_id,
          to_location_id: payload.from_location_id,
          qty: undoQty,
          idempotency_key: newIdempotencyKey(),
          note: `撤销移动：${note.trim() || ""}`,
          from_row: payload.to_row,
          from_column: payload.to_column,
          to_row: payload.from_row,
          to_column: payload.from_column,
        });
        Toast.show({ icon: "success", content: "已撤销移动" });
        void loadMaterials(keyword, 1);
      });
      backToList();
      void loadMaterials(keyword, 1);
      if (stockState.materialBackTo.startsWith("/materials/")) {
        openMaterialDetail(navigate, selected.material.id, detailContextAfterStock(stockState));
      }
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "移动失败" });
    } finally {
      setSubmitting(false);
    }
  };

  if (selected) {
    return (
      <>
        <SectionCard
          title="确认移动"
          subtitle={`${selected.material.name} · 总库存 ${selected.total_quantity} ${selected.material.unit} · 移动不改变总库存`}
        >
          <button type="button" className="back-link" onClick={backToList}>
            ← 返回物料列表
          </button>
          <div className="material-selected" style={{ marginTop: 12 }}>
            <div>
              <div className="material-selected-name">{selected.material.name}</div>
              <div className="material-selected-code">{selected.material.code}</div>
            </div>
            <span className="stock-badge">总库存 {selected.total_quantity}</span>
          </div>
          <Form layout="vertical" className="form-card">
            <Form.Item label="源库位 / 格位">
              <Selector
                options={sourceOptions}
                value={fromSlotKey ? [fromSlotKey] : []}
                onChange={(arr) => {
                  const next = arr[0] ?? "";
                  setFromSlotKey(next);
                  const nextLoc = parseInventorySlotKey(next).location_id;
                  if (nextLoc === toLocationId) {
                    setToLocationId(locations.find((loc) => loc.id !== nextLoc)?.id ?? "");
                  }
                  setQty(1);
                }}
              />
            </Form.Item>
            <Form.Item label="目标库位">
              <Selector
                options={locationOptions.filter((option) => option.value !== fromParsed.location_id)}
                value={toLocationId ? [toLocationId] : []}
                onChange={(arr) => {
                  setToLocationId(arr[0] ?? "");
                  setToSlotRow(1);
                  setToSlotColumn(1);
                }}
              />
            </Form.Item>
            {showTargetCabinetSlot && (
              <>
                <Form.Item label="目标货柜行号">
                  <Stepper min={1} max={20} value={toSlotRow} onChange={setToSlotRow} />
                </Form.Item>
                <Form.Item label="目标货柜列号">
                  <Stepper min={1} max={20} value={toSlotColumn} onChange={setToSlotColumn} />
                </Form.Item>
              </>
            )}
            <Form.Item label="移动数量">
              <Stepper min={1} max={maxQty || 1} value={qty} onChange={(v) => setQty(Math.min(v, maxQty || v))} />
            </Form.Item>
            <Form.Item label="备注">
              <TextArea value={note} onChange={setNote} placeholder="如：快递暂存上架 / 整理库位" rows={3} />
            </Form.Item>
          </Form>
        </SectionCard>
        <div className="actions single">
          <Button color="primary" loading={submitting} disabled={!canSubmit} onClick={onSubmit}>
            确认移动
          </Button>
        </div>
      </>
    );
  }

  return (
    <SectionCard
      title="库内移动"
      subtitle={loading && items.length === 0 ? "正在同步…" : `共 ${total} 种有库存物料，用于暂存上架和库位整理`}
    >
      <SearchBar
        placeholder="搜索名称 / 编码 / 条码 / 分类"
        value={keyword}
        onChange={setKeyword}
        onSearch={onSearch}
        onClear={() => {
          setKeyword("");
          void loadMaterials("", 1);
        }}
      />
      <div className="catalog-meta">
        <span>{loading ? "加载中…" : `显示 ${items.length} / ${total} 条${keyword ? "（已筛选）" : ""}`}</span>
      </div>
      {loading && items.length === 0 ? (
        <EmptyState icon="⏳" text="正在从 Bitable 拉取物料…" />
      ) : items.length === 0 ? (
        <EmptyState icon="📦" text={keyword ? "没有匹配的物料" : "暂无可移动物料"} />
      ) : (
        <div className="catalog-list">
          {items.map((item) => (
            <button key={item.id} type="button" className="catalog-row" onClick={() => selectMaterial(item)}>
              <div className="catalog-row-main">
                <div className="catalog-row-name">{item.name}</div>
                <div className="catalog-row-meta">
                  <span className="chip">{item.code}</span>
                  {(item.major_category || item.category_name) && (
                    <span className="chip chip-muted">{item.major_category ?? item.category_name}</span>
                  )}
                  {item.sub_category && <span className="chip chip-muted">{item.sub_category}</span>}
                  <span className="chip chip-muted">{item.unit}</span>
                </div>
                <div className="catalog-row-locs">{item.locations_summary ?? "暂无库位库存"}</div>
              </div>
              <div className="catalog-row-right">
                <span className="stock-badge">{item.total_quantity}</span>
                <span className="material-card-arrow">›</span>
              </div>
            </button>
          ))}
          {hasMore && (
            <div className="load-more">
              <Button loading={loading} fill="outline" block onClick={loadMore}>
                加载更多
              </Button>
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}
