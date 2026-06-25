import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useDataMutationRefetch } from "../utils/dataMutation";
import {
  navigateAfterStockSubmit,
  readStockNavState,
} from "../utils/detailNavigation";
import { EmptyState, SectionCard, StockFormShell } from "./ui";
import { ScanBarcodeButton } from "./ScanBarcodeButton";
import { newIdempotencyKey } from "../utils/idempotency";
import { emptySlotSelection, LocationSlotPicker } from "./LocationSlotPicker";
import { buildSlotPayload, type SlotSelection } from "../utils/inventorySlot";
import { isGridCapableLocation } from "../utils/shelfGrid";
import { applicantPayload, FeishuUserPicker, type ApplicantSelection } from "./FeishuUserPicker";

export function StockInboundPanel({ active = true }: { active?: boolean }) {
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
  const stockState = readStockNavState(location.state, presetMaterialId || undefined);

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
  const [slotSelection, setSlotSelection] = useState<SlotSelection>(emptySlotSelection());
  const [applicant, setApplicant] = useState<ApplicantSelection | null>(null);
  const { canInbound, user } = useAuth();
  const isDirectInbound = canInbound;
  const currentApplicant = user ? { open_id: user.open_id, name: user.name } : null;
  const listLoadedRef = useRef(false);

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
    if (!active || listLoadedRef.current) return;
    listLoadedRef.current = true;
    void loadMaterials("", 1);
    void loadMeta();
  }, [active, loadMaterials, loadMeta]);

  useDataMutationRefetch(["locations", "inventory", "materials"], () => {
    void loadMeta();
    void loadMaterials(keyword, 1);
  }, active);

  useEffect(() => {
    if (!active || !shouldLoadPreset) return;
    if (presetLocationId) setLocationId(presetLocationId);
    if (Number.isFinite(presetRow) && presetRow > 0) {
      setSlotSelection({
        row: presetRow,
        column: Number.isFinite(presetColumn) && presetColumn > 0 ? presetColumn : null,
      });
    }
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
    active,
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

  const selectedLocation = useMemo(
    () => locations.find((loc) => loc.id === locationId),
    [locationId, locations],
  );

  const showGridSlot = Boolean(isDirectInbound && selectedLocation && isGridCapableLocation(selectedLocation));
  const slotPayload = useMemo(
    () => buildSlotPayload(selectedLocation, [], slotSelection),
    [selectedLocation, slotSelection],
  );

  const canSubmit = Boolean(
    selected &&
      qty > 0 &&
      !loading &&
      (isDirectInbound ? locationId : true) &&
      (!showGridSlot || Object.keys(slotPayload).length > 0),
  );
  const hasMore = items.length < total;

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
      setSlotSelection(emptySlotSelection());
      setApplicant(null);
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
    setSlotSelection(emptySlotSelection());
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
      Toast.show({ content: isDirectInbound ? "请选择物料、库位并填写数量" : "请选择物料并填写数量" });
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
          ...slotPayload,
          ...applicantPayload(applicant, currentApplicant),
        });
        Toast.show({ icon: "success", content: isReturnInbound ? "归还入库成功" : "入库成功" });
        navigateAfterStockSubmit(navigate, selected.material.id, stockState);
      } else {
        await createStockRequest({
          type: "入库",
          material_id: selected.material.id,
          qty,
          idempotency_key: newIdempotencyKey(),
          note: note.trim() || undefined,
          ...applicantPayload(applicant, currentApplicant),
        });
        Toast.show({ icon: "success", content: "已提交入库申请" });
        navigateAfterStockSubmit(navigate, selected.material.id, stockState);
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
      <StockFormShell
        action={
          <Button color="primary" loading={submitting} disabled={!canSubmit} onClick={onSubmit}>
            {isDirectInbound ? "确认入库并同步" : "提交入库申请"}
          </Button>
        }
      >
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
                    onChange={(arr) => {
                      setLocationId(arr[0] ?? "");
                      setSlotSelection(emptySlotSelection());
      setApplicant(null);
                    }}
                  />
                </Form.Item>
                {locationId && selectedStock !== null && (
                  <div className="stock-hint">该库位当前库存：{selectedStock}</div>
                )}
                {showGridSlot && selectedLocation && (
                  <LocationSlotPicker
                    location={selectedLocation}
                    materialId={selected.material.id}
                    value={slotSelection}
                    onChange={setSlotSelection}
                  />
                )}
              </>
            ) : (
              <div className="stock-hint">归还目标库位与具体格位由库管审批时指定，您只需填写数量与说明。</div>
            )}
            <Form.Item label={isDirectInbound ? "领用/归还人（可选）" : "申请人"}>
              <FeishuUserPicker
                label={isDirectInbound ? "实际操作对象" : "申请人"}
                value={applicant}
                onChange={setApplicant}
                allowProxy={canInbound}
                currentUser={user ? { open_id: user.open_id, name: user.name } : null}
                placeholder="搜索姓名，如：张工"
              />
            </Form.Item>
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
            <Form.Item label="备注（可选）">
              <TextArea
                value={note}
                onChange={setNote}
                placeholder={isDirectInbound ? "采购单号 / 归还说明 / 供应商" : "归还原因 / 来源说明"}
                rows={3}
              />
            </Form.Item>
          </Form>
        </SectionCard>
      </StockFormShell>
    );
  }

  return (
    <>
      <SectionCard
        title={isDirectInbound ? "入库上架" : "入库申请"}
        subtitle={loading && items.length === 0 ? "正在同步…" : `共 ${total} 种物料`}
      >
        <div className="search-bar-with-scan">
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
          <ScanBarcodeButton
            onScan={(code) => {
              setKeyword(code);
              void loadMaterials(code, 1);
            }}
            disabled={loading}
          />
        </div>
      <div className="catalog-meta">
        <span>{loading ? "加载中…" : `显示 ${items.length} / ${total} 条${keyword ? "（已筛选）" : ""}`}</span>
      </div>
        {loading && items.length === 0 ? (
          <EmptyState loading text="正在从 Bitable 拉取物料…" />
        ) : items.length === 0 ? (
          <EmptyState
            icon="package"
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
