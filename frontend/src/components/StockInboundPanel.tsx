import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Form, Input, SearchBar, Selector, Stepper, TextArea, Toast } from "antd-mobile";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  createStockRequest,
  createMaterial,
  getMaterial,
  listCategories,
  listLocations,
  postInbound,
  searchMaterials,
} from "../api";
import type { Category, Location, MaterialDetail, MaterialSearchItem } from "../api/types";
import { useAuth } from "./AuthGate";
import { CacheRefreshButton } from "./CacheRefreshButton";
import { EmptyState, SectionCard } from "./ui";

function newIdempotencyKey() {
  return crypto.randomUUID();
}

export function StockInboundPanel() {
  const pageSize = 20;
  const [params] = useSearchParams();
  const presetMaterialId = params.get("material_id") ?? "";
  const presetQty = Number(params.get("qty") ?? "");
  const presetReturnNote = params.get("return_note") ?? "";
  const activeTab = params.get("tab");
  const shouldLoadPreset = activeTab === "inbound";
  const navigate = useNavigate();

  const [items, setItems] = useState<MaterialSearchItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [locationOptions, setLocationOptions] = useState<{ label: string; value: string }[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [selected, setSelected] = useState<MaterialDetail | null>(null);
  const [locationId, setLocationId] = useState("");
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const [inboundSpec, setInboundSpec] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showCreateMaterial, setShowCreateMaterial] = useState(false);
  const [creatingMaterial, setCreatingMaterial] = useState(false);
  const [newMaterialName, setNewMaterialName] = useState("");
  const [newMaterialCode, setNewMaterialCode] = useState("");
  const [newMaterialMajorCategory, setNewMaterialMajorCategory] = useState("");
  const [newMaterialCategoryId, setNewMaterialCategoryId] = useState("");
  const [newMaterialUnit, setNewMaterialUnit] = useState("个");
  const [newMaterialSpec, setNewMaterialSpec] = useState("");
  const [newMaterialBarcode, setNewMaterialBarcode] = useState("");
  const [newMaterialSupplier, setNewMaterialSupplier] = useState("");
  const [newMaterialMinStock, setNewMaterialMinStock] = useState(5);
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
      const [locs, cats] = await Promise.all([listLocations(), listCategories()]);
      setLocations(locs);
      setLocationOptions(
        locs.map((loc) => ({
          label: `${loc.name}（${loc.code}）`,
          value: loc.id,
        })),
      );
      setCategories(cats);
      setNewMaterialMajorCategory(
        (current) => current || cats[0]?.major_name || cats[0]?.name || "",
      );
      setNewMaterialCategoryId((current) => current || cats[0]?.id || "");
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
    if (!presetMaterialId || !shouldLoadPreset) return;
    void (async () => {
      try {
        const detail = await getMaterial(presetMaterialId);
        setSelected(detail);
        setInboundSpec(detail.material.spec ?? "");
        const defaultLoc =
          detail.material.default_location_id ?? detail.inventory[0]?.location_id ?? locationId;
        if (defaultLoc) setLocationId(defaultLoc);
        if (Number.isFinite(presetQty) && presetQty > 0) setQty(presetQty);
        if (presetReturnNote.trim()) setNote(presetReturnNote.trim());
      } catch (e) {
        Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "加载物料失败" });
      }
    })();
  }, [locationId, presetMaterialId, presetQty, presetReturnNote, shouldLoadPreset]);

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
  const majorCategoryOptions = useMemo(() => {
    const values = Array.from(
      new Set(categories.map((category) => category.major_name || category.name).filter(Boolean)),
    );
    return values.map((value) => ({ label: value, value }));
  }, [categories]);
  const subCategoryOptions = useMemo(
    () =>
      categories
        .filter((category) => (category.major_name || category.name) === newMaterialMajorCategory)
        .map((category) => ({
          label: category.sub_name || category.name,
          value: category.id,
        })),
    [categories, newMaterialMajorCategory],
  );
  const selectedCategory = useMemo(
    () => categories.find((category) => category.id === newMaterialCategoryId),
    [categories, newMaterialCategoryId],
  );

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

  const resetCreateForm = () => {
    setNewMaterialName("");
    setNewMaterialCode("");
    setNewMaterialUnit("个");
    setNewMaterialSpec("");
    setNewMaterialBarcode("");
    setNewMaterialSupplier("");
    setNewMaterialMinStock(5);
  };

  const onCreateMaterial = async () => {
    if (!newMaterialName.trim() || !newMaterialMajorCategory || !newMaterialCategoryId) {
      Toast.show({ content: "请填写物料名称、大类和子类" });
      return;
    }
    setCreatingMaterial(true);
    try {
      const material = await createMaterial({
        name: newMaterialName.trim(),
        category_id: newMaterialCategoryId,
        major_category: newMaterialMajorCategory,
        sub_category: selectedCategory?.sub_name || selectedCategory?.name,
        code: newMaterialCode.trim() || undefined,
        unit: newMaterialUnit.trim() || "个",
        spec: newMaterialSpec.trim() || undefined,
        barcode: newMaterialBarcode.trim() || undefined,
        default_location_id: locationId || undefined,
        supplier: newMaterialSupplier.trim() || undefined,
        min_stock: newMaterialMinStock,
      });
      const detail: MaterialDetail = {
        material,
        inventory: [],
        total_quantity: 0,
      };
      setSelected(detail);
      setItems((current) => [
        {
          ...material,
          total_quantity: 0,
          locations_summary: "暂无库存",
        },
        ...current,
      ]);
      if (material.default_location_id) {
        setLocationId(material.default_location_id);
      }
      resetCreateForm();
      setShowCreateMaterial(false);
      Toast.show({ icon: "success", content: "已新增物料，可继续入库" });
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "新增物料失败" });
    } finally {
      setCreatingMaterial(false);
    }
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
          navigate(canInbound ? "/history?view=returns" : "/returns");
        } else {
          navigate(`/materials/${selected.material.id}`);
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
        navigate("/history");
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
        <div className="catalog-meta" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>{loading ? "加载中…" : `显示 ${items.length} / ${total} 条${keyword ? "（已筛选）" : ""}`}</span>
          {isDirectInbound ? <CacheRefreshButton onRefreshed={() => loadMaterials(keyword, 1)} /> : null}
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
                  {isDirectInbound && (
                    <button
                      type="button"
                      className="catalog-manage-link"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/materials/${item.id}`);
                      }}
                    >
                      管理
                    </button>
                  )}
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

      {isDirectInbound && !loading && locationOptions.length > 0 && categories.length > 0 && (
        <SectionCard
          title="快捷新增物料"
          subtitle="搜索不到物料时，先建档再入库"
          className="create-material-card"
        >
          {!showCreateMaterial ? (
            <Button block fill="outline" color="primary" onClick={() => setShowCreateMaterial(true)}>
              新增数据表中没有的物料
            </Button>
          ) : (
            <Form layout="vertical" className="form-card">
              <Form.Item label="物料名称">
                <Input
                  value={newMaterialName}
                  onChange={setNewMaterialName}
                  placeholder="如：力矩传感器 / 新型号电机"
                />
              </Form.Item>
              <Form.Item label="大类">
                <Selector
                  options={majorCategoryOptions}
                  value={newMaterialMajorCategory ? [newMaterialMajorCategory] : []}
                  onChange={(arr) => {
                    const nextMajor = arr[0] ?? "";
                    setNewMaterialMajorCategory(nextMajor);
                    const firstSub = categories.find(
                      (category) => (category.major_name || category.name) === nextMajor,
                    );
                    setNewMaterialCategoryId(firstSub?.id ?? "");
                  }}
                />
              </Form.Item>
              <Form.Item label="子类">
                <Selector
                  options={subCategoryOptions}
                  value={newMaterialCategoryId ? [newMaterialCategoryId] : []}
                  onChange={(arr) => setNewMaterialCategoryId(arr[0] ?? "")}
                />
              </Form.Item>
              <Form.Item label="默认库位">
                <Selector
                  options={locationOptions}
                  value={locationId ? [locationId] : []}
                  onChange={(arr) => setLocationId(arr[0] ?? "")}
                />
              </Form.Item>
              <Form.Item label="单位">
                <Input value={newMaterialUnit} onChange={setNewMaterialUnit} placeholder="个 / 套 / 米" />
              </Form.Item>
              <Form.Item label="物料编码（可选）">
                <Input value={newMaterialCode} onChange={setNewMaterialCode} placeholder="不填则自动生成" />
              </Form.Item>
              <Form.Item label="规格型号（可选）">
                <Input value={newMaterialSpec} onChange={setNewMaterialSpec} placeholder="品牌 / 型号 / 规格" />
              </Form.Item>
              <Form.Item label="条码（可选）">
                <Input value={newMaterialBarcode} onChange={setNewMaterialBarcode} placeholder="扫码编号或外部编码" />
              </Form.Item>
              <Form.Item label="供货商（可选）">
                <Input
                  value={newMaterialSupplier}
                  onChange={setNewMaterialSupplier}
                  placeholder="如：XX 电子 / 官方旗舰店"
                />
              </Form.Item>
              <Form.Item label="安全库存">
                <Stepper min={0} value={newMaterialMinStock} onChange={setNewMaterialMinStock} />
              </Form.Item>
              <div className="actions two">
                <Button disabled={creatingMaterial} onClick={() => setShowCreateMaterial(false)}>
                  取消
                </Button>
                <Button color="primary" loading={creatingMaterial} onClick={onCreateMaterial}>
                  保存并选中
                </Button>
              </div>
            </Form>
          )}
        </SectionCard>
      )}
    </>
  );
}
