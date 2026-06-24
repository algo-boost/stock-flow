import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Form, Input, SearchBar, Selector, Stepper, TextArea, Toast } from "antd-mobile";
import { useNavigate, useSearchParams, useLocation } from "react-router-dom";
import {
  createStockRequest,
  getMaterial,
  listLocations,
  postInbound,
  searchMaterials,
} from "../api";
import type { Location, MaterialDetail, MaterialSearchItem } from "../api/types";
import { useAuth } from "./AuthGate";
import {
  detailContextAfterStock,
  openMaterialDetail,
  readStockNavState,
} from "../utils/detailNavigation";
import { EmptyState, SectionCard } from "./ui";

function newIdempotencyKey() {
  return crypto.randomUUID();
}

export function StockInboundPanel() {
  const pageSize = 20;
  const [params] = useSearchParams();
  const presetMaterialId = params.get("material_id") ?? "";
  const presetLocationId = params.get("location_id") ?? "";
  const presetRow = Number(params.get("row") ?? "");
  const presetColumn = Number(params.get("column") ?? "");
  const presetQty = Number(params.get("qty") ?? "");
  const presetReturnNote = params.get("return_note") ?? "";
  const activeTab = params.get("tab");
  const shouldLoadPreset = activeTab === "inbound";
  const navigate = useNavigate();
  const location = useLocation();
  const stockState = readStockNavState(location.state);

  const [items, setItems] = useState<MaterialSearchItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [locationOptions, setLocationOptions] = useState<{ label: string; value: string }[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [selected, setSelected] = useState<MaterialDetail | null>(null);
  const [locationId, setLocationId] = useState("");
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const [inboundSpec, setInboundSpec] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [slotRow, setSlotRow] = useState(1);
  const [slotColumn, setSlotColumn] = useState(1);
  const { canInbound } = useAuth();
  const isDirectInbound = canInbound;

  const loadMaterials = useCallback(async (q = "", nextPage = 1, append = false) => {
    setLoading(true);
    try {
      const data = await searchMaterials(q, { page: nextPage, size: pageSize });
      setItems((current) => (append ? [...current, ...data.items] : data.items));
      setPage(data.page);
      setTotal(data.total);
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "加载 Bitable 物料失败" });
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMeta = useCallback(async () => {
    try {
      const [locs] = await Promise.all([listLocations()]);
      setLocations(locs);
      setLocationOptions(
        locs.map((loc) => ({
          label: `${loc.name}（${loc.code}）`,
          value: loc.id,
        })),
      );
      setLocationId((current) => current || locs[0]?.id || "");
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "加载库位/分类失败" });
    }
  }, []);

  useEffect(() => {
    void loadMaterials("", 1);
    void loadMeta();
  }, [loadMaterials, loadMeta]);

  useEffect(() => {
    if (!shouldLoadPreset) return;
    if (presetLocationId) setLocationId(presetLocationId);
    if (Number.isFinite(presetRow) && presetRow > 0) setSlotRow(presetRow);
    if (Number.isFinite(presetColumn) && presetColumn > 0) setSlotColumn(presetColumn);
    if (!presetMaterialId) return;
    void (async () => {
      try {
        const detail = await getMaterial(presetMaterialId);
        setSelected(detail);
        setInboundSpec(detail.material.spec ?? "");
        const defaultLoc =
          presetLocationId ||
          detail.material.default_location_id ||
          detail.inventory[0]?.location_id ||
          locationId;
        if (defaultLoc) setLocationId(defaultLoc);
        if (Number.isFinite(presetQty) && presetQty > 0) setQty(presetQty);
        if (presetReturnNote.trim()) setNote(presetReturnNote.trim());
      } catch (e) {
        Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "加载物料失败" });
      }
    })();
  }, [
    locationId,
    presetColumn,
    presetLocationId,
    presetMaterialId,
    presetQty,
    presetReturnNote,
    presetRow,
    shouldLoadPreset,
  ]);

  const selectedStock = useMemo(() => {
    if (!selected || !locationId) return null;
    return selected.inventory.find((i) => i.location_id === locationId)?.quantity ?? 0;
  }, [selected, locationId]);

  const canSubmit = Boolean(
    selected &&
      qty > 0 &&
      !loading &&
      note.trim() &&
      (isDirectInbound ? locationId : true),
  );
  const hasMore = items.length < total;

  const selectedLocation = useMemo(
    () => locations.find((loc) => loc.id === locationId),
    [locationId, locations],
  );
  const showCabinetSlot = isDirectInbound && selectedLocation?.type === "货柜";

  const selectMaterial = async (item: MaterialSearchItem) => {
    setLoading(true);
    try {
      const detail = await getMaterial(item.id);
      setSelected(detail);
      const defaultLoc =
        detail.material.default_location_id ?? detail.inventory[0]?.location_id ?? locationId;
      if (defaultLoc) setLocationId(defaultLoc);
      setQty(1);
      setNote("");
      setInboundSpec(detail.material.spec ?? "");
      setSlotRow(1);
      setSlotColumn(1);
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "加载物料失败" });
    } finally {
      setLoading(false);
    }
  };

  const backToList = () => {
    setSelected(null);
    setQty(1);
    setNote("");
    setInboundSpec("");
    setSlotRow(1);
    setSlotColumn(1);
  };

  const onSearch = (val: string) => {
    setKeyword(val);
    void loadMaterials(val, 1);
  };

  const loadMore = () => {
    void loadMaterials(keyword, page + 1, true);
  };

  const onSubmit = async () => {
    if (!selected || !canSubmit) {
      Toast.show({ content: isDirectInbound ? "请填写物料、库位和数量" : "请填写物料、数量和归还说明" });
      return;
    }
    setSubmitting(true);
    try {
      if (isDirectInbound) {
        const trimmedNote = note.trim();
        const returnPreset = presetReturnNote.trim();
        const isReturnFlow = returnPreset.includes("归还");
        const effectiveNote =
          trimmedNote || (isReturnFlow ? "归还" : "");
        const isReturnInbound = effectiveNote.includes("归还");
        await postInbound({
          material_id: selected.material.id,
          location_id: locationId,
          qty,
          idempotency_key: newIdempotencyKey(),
          note: effectiveNote || undefined,
          spec: inboundSpec.trim() || undefined,
          row: showCabinetSlot ? slotRow : undefined,
          column: showCabinetSlot ? slotColumn : undefined,
        });
        Toast.show({ icon: "success", content: isReturnInbound ? "归还入库成功" : "入库成功" });
        if (isReturnInbound) {
          navigate(canInbound ? "/history?view=returns" : "/history?view=returns");
        } else if (stockState.materialBackTo.startsWith("/materials/")) {
          openMaterialDetail(navigate, selected.material.id, detailContextAfterStock(stockState));
        } else {
          openMaterialDetail(navigate, selected.material.id, { backTo: "/" });
        }
      } else {
        await createStockRequest({
          type: "入库",
          material_id: selected.material.id,
          qty,
          idempotency_key: newIdempotencyKey(),
          note: note.trim(),
        });
        Toast.show({ icon: "success", content: "已提交入库申请" });
        if (stockState.materialBackTo.startsWith("/materials/")) {
          openMaterialDetail(navigate, selected.material.id, detailContextAfterStock(stockState));
        } else {
          navigate("/history");
        }
      }
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "入库失败" });
    } finally {
      setSubmitting(false);
    }
  };

  if (selected) {
    const m = selected.material;
    return (
      <>
        <SectionCard
          title={isDirectInbound ? "确认入库" : "提交入库申请"}
          subtitle={`${m.name} · 当前总库存 ${selected.total_quantity} ${m.unit} · ${
            isDirectInbound ? "库管 / 管理员直接入库" : "提交后等待管理员审批"
          }`}
        >
          <button type="button" className="back-link" onClick={backToList}>
            ← 返回物料列表
          </button>
          <div className="material-selected" style={{ marginTop: 12 }}>
            <div>
              <div className="material-selected-name">{m.name}</div>
              <div className="material-selected-code">{m.code}</div>
            </div>
            <span className="stock-badge">总库存 {selected.total_quantity}</span>
          </div>
          <Form layout="vertical" className="form-card">
            {isDirectInbound ? (
              <>
                <Form.Item label="目标库位">
                  <Selector
                    options={locationOptions}
                    value={locationId ? [locationId] : []}
                    onChange={(arr) => setLocationId(arr[0] ?? "")}
                  />
                </Form.Item>
                {locationId && selectedStock !== null && (
                  <div className="stock-hint">该库位当前库存：{selectedStock}</div>
                )}
                {showCabinetSlot && (
                  <>
                    <Form.Item label="货柜行号">
                      <Stepper min={1} max={20} value={slotRow} onChange={setSlotRow} />
                    </Form.Item>
                    <Form.Item label="货柜列号">
                      <Stepper min={1} max={20} value={slotColumn} onChange={setSlotColumn} />
                    </Form.Item>
                  </>
                )}
              </>
            ) : (
              <div className="stock-hint">归还目标库位与货柜格位由库管审批时指定，您只需填写数量与说明。</div>
            )}
            <Form.Item label="入库数量">
              <Stepper min={1} value={qty} onChange={setQty} />
            </Form.Item>
            {isDirectInbound && (
              <Form.Item label="型号（可选）">
                <Input
                  value={inboundSpec}
                  onChange={setInboundSpec}
                  placeholder="入库时补充或更新物料型号 / 规格"
                />
              </Form.Item>
            )}
            <Form.Item label="备注">
              <TextArea
                value={note}
                onChange={setNote}
                placeholder={isDirectInbound ? "采购单号 / 归还说明 / 供应商" : "归还原因 / 来源说明（必填）"}
                rows={3}
              />
            </Form.Item>
          </Form>
        </SectionCard>
        <div className="actions single">
          <Button color="primary" loading={submitting} disabled={!canSubmit} onClick={onSubmit}>
            {isDirectInbound ? "确认入库并同步" : "提交入库申请"}
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <SectionCard
        title={isDirectInbound ? "入库上架" : "入库申请"}
        subtitle={loading && items.length === 0 ? "正在同步…" : `共 ${total} 种物料`}
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
          <EmptyState
            icon="📦"
            text={keyword ? "没有匹配的物料" : "暂无物料"}
            hint={isDirectInbound ? "可在下方快捷新增物料" : "请联系库管先维护物料主数据"}
          />
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
                    {item.supplier && <span className="chip chip-muted">{item.supplier}</span>}
                    <span className="chip chip-muted">{item.unit}</span>
                  </div>
                  <div className="catalog-row-locs">{item.locations_summary ?? "暂无库存"}</div>
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
    </>
  );
}
