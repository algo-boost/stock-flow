import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Form, SearchBar, Selector, Stepper, TextArea, Toast } from "antd-mobile";
import { useSearchParams } from "react-router-dom";
import { createStockRequest, getMaterial, postOutbound, searchMaterials } from "../api";
import type { MaterialDetail, MaterialSearchItem } from "../api/types";
import {
  findInventoryBySlotKey,
  formatCatalogLocationSummary,
  formatInventorySlot,
  inventorySlotKey,
  parseInventorySlotKey,
} from "../utils/inventoryDisplay";
import { CacheRefreshButton } from "./CacheRefreshButton";
import { useAuth } from "./AuthGate";
import { EmptyState, SectionCard } from "./ui";

function newIdempotencyKey() {
  return crypto.randomUUID();
}

function applyLocalOutbound(
  items: MaterialSearchItem[],
  materialId: string,
  qty: number,
): MaterialSearchItem[] {
  return items
    .map((item) => {
      if (item.id !== materialId) return item;
      return { ...item, total_quantity: Math.max(0, item.total_quantity - qty) };
    })
    .filter((item) => item.total_quantity > 0);
}

export function StockOutboundPanel() {
  const pageSize = 20;
  const [params] = useSearchParams();
  const presetMaterialId = params.get("material_id") ?? "";
  const activeTab = params.get("tab");
  const shouldLoadPreset = !activeTab || activeTab === "outbound";

  const [items, setItems] = useState<MaterialSearchItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [selected, setSelected] = useState<MaterialDetail | null>(null);
  const [slotKey, setSlotKey] = useState("");
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const [returnPolicy, setReturnPolicy] = useState<"" | "required" | "not_required">("");
  const [returnDueDate, setReturnDueDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { canInbound } = useAuth();
  const isDirectOutbound = canInbound;

  const loadMaterials = useCallback(async (q = "", nextPage = 1, append = false) => {
    setLoading(true);
    try {
      const data = await searchMaterials(q, { page: nextPage, size: pageSize, stockOnly: true });
      setItems((current) => (append ? [...current, ...data.items] : data.items));
      setPage(data.page);
      setTotal(data.total);
    } catch (e) {
      Toast.show({
        icon: "fail",
        content: e instanceof Error ? e.message : "加载 Bitable 物料失败",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMaterials("", 1);
  }, [loadMaterials]);

  useEffect(() => {
    if (!presetMaterialId || !shouldLoadPreset) return;
    void (async () => {
      try {
        const detail = await getMaterial(presetMaterialId);
        setSelected(detail);
        setSlotKey(detail.inventory[0] ? inventorySlotKey(detail.inventory[0]) : "");
        setQty(1);
        setNote("");
        setReturnPolicy("");
        setReturnDueDate("");
      } catch (e) {
        Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "加载物料失败" });
      }
    })();
  }, [presetMaterialId, shouldLoadPreset]);

  const selectMaterial = async (item: MaterialSearchItem) => {
    setLoading(true);
    try {
      const detail = await getMaterial(item.id);
      setSelected(detail);
      const first = detail.inventory[0];
      setSlotKey(first ? inventorySlotKey(first) : "");
      setQty(1);
      setNote("");
      setReturnPolicy("");
      setReturnDueDate("");
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
    setSlotKey("");
    setQty(1);
    setNote("");
    setReturnPolicy("");
    setReturnDueDate("");
  };

  const locationOptions = useMemo(
    () =>
      (selected?.inventory ?? []).map((inv) => ({
        label: `${formatInventorySlot(inv)}（可用 ${inv.quantity}）`,
        value: inventorySlotKey(inv),
      })),
    [selected],
  );

  const selectedInventory = selected ? findInventoryBySlotKey(selected.inventory, slotKey) : undefined;
  const maxQty = selectedInventory?.quantity ?? 0;
  const slotParsed = parseInventorySlotKey(slotKey);
  const returnPolicyOk =
    returnPolicy === "not_required" || (returnPolicy === "required" && returnDueDate);
  const canSubmit = Boolean(
    selected && slotKey && qty > 0 && qty <= maxQty && note.trim() && returnPolicyOk,
  );

  const onSubmit = async () => {
    if (!selected || !canSubmit) {
      Toast.show({ content: "请填写完整出库信息" });
      return;
    }
    setSubmitting(true);
    try {
      if (isDirectOutbound) {
        await postOutbound({
          material_id: selected.material.id,
          location_id: slotParsed.location_id,
          qty,
          idempotency_key: newIdempotencyKey(),
          note: note.trim(),
          return_required: returnPolicy === "required",
          return_due_at: returnPolicy === "required" ? returnDueDate : undefined,
          row: slotParsed.row,
          column: slotParsed.column,
        });
        Toast.show({ icon: "success", content: "出库成功" });
        setItems((current) => applyLocalOutbound(current, selected.material.id, qty));
      } else {
        await createStockRequest({
          type: "出库",
          material_id: selected.material.id,
          location_id: slotParsed.location_id,
          qty,
          idempotency_key: newIdempotencyKey(),
          note: note.trim(),
          return_required: returnPolicy === "required",
          return_due_at: returnPolicy === "required" ? returnDueDate : undefined,
          row: slotParsed.row,
          column: slotParsed.column,
        });
        Toast.show({ icon: "success", content: "已提交出库申请" });
      }
      backToList();
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "出库失败" });
    } finally {
      setSubmitting(false);
    }
  };

  if (selected) {
    const m = selected.material;
    return (
      <>
        <SectionCard
          title="确认出库"
          subtitle={`${m.name} · 库存 ${selected.total_quantity} ${m.unit} · ${
            isDirectOutbound ? "用途与归还计划必填，便于追溯" : "提交后等待管理员审批"
          }`}
        >
          <button type="button" className="back-link" onClick={backToList}>
            ← 返回物料列表
          </button>
          <div className="material-selected" style={{ marginTop: 12 }}>
            <div>
              <div className="material-selected-name">{m.name}</div>
            </div>
            <span className="stock-badge">总库存 {selected.total_quantity}</span>
          </div>

          {locationOptions.length === 0 ? (
            <EmptyState icon="🏷️" text="该物料暂无库存" hint="请联系库管入库" />
          ) : (
            <Form layout="vertical" className="form-card">
              <Form.Item label="出库库位 / 格位">
                <Selector
                  options={locationOptions}
                  value={slotKey ? [slotKey] : []}
                  onChange={(arr) => setSlotKey(arr[0] ?? "")}
                />
              </Form.Item>
              <Form.Item label="出库数量">
                <Stepper
                  min={1}
                  max={maxQty || 1}
                  value={qty}
                  onChange={(v) => setQty(Math.min(v, maxQty || v))}
                />
              </Form.Item>
              <Form.Item label="用途说明">
                <TextArea
                  placeholder="项目 / 实验 / 领用人用途"
                  value={note}
                  onChange={setNote}
                  rows={3}
                />
              </Form.Item>
              <Form.Item label="归还计划">
                <Selector
                  options={[
                    { label: "需要归还", value: "required" },
                    { label: "无须归还", value: "not_required" },
                  ]}
                  value={returnPolicy ? [returnPolicy] : []}
                  onChange={(arr) => {
                    const next = (arr[0] as "required" | "not_required" | undefined) ?? "";
                    setReturnPolicy(next);
                    if (next !== "required") setReturnDueDate("");
                  }}
                />
              </Form.Item>
              {returnPolicy === "required" && (
                <Form.Item label="预计归还时间">
                  <input
                    type="date"
                    className="native-date-input"
                    value={returnDueDate}
                    onChange={(e) => setReturnDueDate(e.target.value)}
                  />
                </Form.Item>
              )}
            </Form>
          )}
        </SectionCard>

        <div className="actions single">
          <Button color="primary" loading={submitting} disabled={!canSubmit} onClick={onSubmit}>
            {isDirectOutbound ? "确认出库" : "提交出库申请"}
          </Button>
        </div>
      </>
    );
  }

  return (
    <SectionCard
      title={isDirectOutbound ? "出库领用" : "出库申请"}
      subtitle={loading && items.length === 0 ? "正在同步…" : `共 ${total} 种可出库物料`}
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
      <div className="catalog-meta" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>{loading ? "加载中…" : `显示 ${items.length} / ${total} 条${keyword ? "（已筛选）" : ""}`}</span>
        {canInbound ? <CacheRefreshButton onRefreshed={() => loadMaterials(keyword, 1)} /> : null}
      </div>

      {loading && items.length === 0 ? (
        <EmptyState icon="⏳" text="正在从 Bitable 拉取物料…" />
      ) : items.length === 0 ? (
        <EmptyState
          icon="📦"
          text={keyword ? "没有匹配的物料" : "暂无可出库物料"}
          hint={keyword ? "换个关键词试试" : "请先在 Bitable 维护库存"}
        />
      ) : (
        <div className="catalog-list">
          {items.map((item) => (
            <button key={item.id} type="button" className="catalog-row" onClick={() => selectMaterial(item)}>
              <div className="catalog-row-main">
                <div className="catalog-row-name">{item.name}</div>
                <div className="catalog-row-meta">
                  {(item.major_category || item.category_name) && (
                    <span className="chip chip-muted">{item.major_category ?? item.category_name}</span>
                  )}
                  {item.sub_category && <span className="chip chip-muted">{item.sub_category}</span>}
                  <span className="chip chip-muted">{item.unit}</span>
                </div>
                <div className="catalog-row-locs">
                  {formatCatalogLocationSummary(item.locations_summary, "暂无库位库存")}
                </div>
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
