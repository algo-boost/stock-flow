import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Form, Input, SearchBar, Selector, Stepper, TextArea, Toast } from "antd-mobile";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  createMaterial,
  getMaterial,
  listCategories,
  listLocations,
  postInbound,
  searchMaterials,
} from "../api";
import type { MaterialDetail, MaterialSearchItem } from "../api/types";
import { AuthGate } from "../components/AuthGate";
import { CacheRefreshButton } from "../components/CacheRefreshButton";
import { Layout } from "../components/Layout";
import { EmptyState, PageHero, SectionCard } from "../components/ui";

function newIdempotencyKey() {
  return crypto.randomUUID();
}

function InboundForm() {
  const pageSize = 20;
  const [params] = useSearchParams();
  const presetMaterialId = params.get("material_id") ?? "";
  const navigate = useNavigate();

  const [items, setItems] = useState<MaterialSearchItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [locationOptions, setLocationOptions] = useState<{ label: string; value: string }[]>([]);
  const [categoryOptions, setCategoryOptions] = useState<{ label: string; value: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [selected, setSelected] = useState<MaterialDetail | null>(null);
  const [locationId, setLocationId] = useState("");
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showCreateMaterial, setShowCreateMaterial] = useState(false);
  const [creatingMaterial, setCreatingMaterial] = useState(false);
  const [newMaterialName, setNewMaterialName] = useState("");
  const [newMaterialCode, setNewMaterialCode] = useState("");
  const [newMaterialCategoryId, setNewMaterialCategoryId] = useState("");
  const [newMaterialUnit, setNewMaterialUnit] = useState("个");
  const [newMaterialSpec, setNewMaterialSpec] = useState("");
  const [newMaterialBarcode, setNewMaterialBarcode] = useState("");

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
      const [locs, categories] = await Promise.all([listLocations(), listCategories()]);
      setLocationOptions(
        locs.map((loc) => ({
          label: `${loc.name}（${loc.code}）`,
          value: loc.id,
        })),
      );
      setCategoryOptions(
        categories.map((category) => ({
          label: category.name,
          value: category.id,
        })),
      );
      setNewMaterialCategoryId((current) => current || categories[0]?.id || "");
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
    if (!presetMaterialId) return;
    void (async () => {
      try {
        const detail = await getMaterial(presetMaterialId);
        setSelected(detail);
        const defaultLoc =
          detail.material.default_location_id ?? detail.inventory[0]?.location_id ?? locationId;
        if (defaultLoc) setLocationId(defaultLoc);
      } catch (e) {
        Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "加载物料失败" });
      }
    })();
  }, [locationId, presetMaterialId]);

  const selectedStock = useMemo(() => {
    if (!selected || !locationId) return null;
    return selected.inventory.find((i) => i.location_id === locationId)?.quantity ?? 0;
  }, [selected, locationId]);

  const canSubmit = Boolean(selected && locationId && qty > 0 && !loading);
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
  };

  const onCreateMaterial = async () => {
    if (!newMaterialName.trim() || !newMaterialCategoryId) {
      Toast.show({ content: "请填写物料名称和分类" });
      return;
    }
    setCreatingMaterial(true);
    try {
      const material = await createMaterial({
        name: newMaterialName.trim(),
        category_id: newMaterialCategoryId,
        code: newMaterialCode.trim() || undefined,
        unit: newMaterialUnit.trim() || "个",
        spec: newMaterialSpec.trim() || undefined,
        barcode: newMaterialBarcode.trim() || undefined,
        default_location_id: locationId || undefined,
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
      Toast.show({ content: "请填写物料、库位和数量" });
      return;
    }
    setSubmitting(true);
    try {
      const result = await postInbound({
        material_id: selected.material.id,
        location_id: locationId,
        qty,
        idempotency_key: newIdempotencyKey(),
        note: note.trim() || undefined,
      });
      Toast.show({ icon: "success", content: `已同步 Bitable · ${result.transaction_id}` });
      navigate(`/materials/${selected.material.id}`);
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "入库失败" });
    } finally {
      setSubmitting(false);
    }
  };

  if (selected) {
    const m = selected.material;
    return (
      <Layout title="入库">
        <PageHero
          title="确认入库"
          subtitle={`${m.name} · 当前总库存 ${selected.total_quantity} ${m.unit}`}
          extra={<CacheRefreshButton onRefreshed={() => loadMaterials(keyword, 1)} />}
        />
        <SectionCard title="入库单" subtitle="库管 / 管理员">
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
            <Form.Item label="入库数量">
              <Stepper min={1} value={qty} onChange={setQty} />
            </Form.Item>
            <Form.Item label="备注">
              <TextArea
                value={note}
                onChange={setNote}
                placeholder="采购单号 / 归还说明 / 供应商"
                rows={3}
              />
            </Form.Item>
          </Form>
        </SectionCard>
        <div className="actions single">
          <Button color="primary" loading={submitting} disabled={!canSubmit} onClick={onSubmit}>
            确认入库并同步
          </Button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="入库">
      <PageHero
        title="入库上架"
        subtitle="默认分页显示全部物料，找不到时可快捷新增"
        extra={<CacheRefreshButton onRefreshed={() => loadMaterials(keyword, 1)} />}
      />

      <SectionCard title="选择物料" subtitle={loading && items.length === 0 ? "正在同步…" : `共 ${total} 种物料`}>
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
          {loading ? "加载中…" : `显示 ${items.length} / ${total} 条${keyword ? "（已筛选）" : ""}`}
        </div>
        {loading && items.length === 0 ? (
          <EmptyState icon="⏳" text="正在从 Bitable 拉取物料…" />
        ) : items.length === 0 ? (
          <EmptyState
            icon="📦"
            text={keyword ? "没有匹配的物料" : "暂无物料"}
            hint="可在下方快捷新增物料"
          />
        ) : (
          <div className="catalog-list">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className="catalog-row"
                onClick={() => selectMaterial(item)}
              >
                <div className="catalog-row-main">
                  <div className="catalog-row-name">{item.name}</div>
                  <div className="catalog-row-meta">
                    <span className="chip">{item.code}</span>
                    {item.category_name && (
                      <span className="chip chip-muted">{item.category_name}</span>
                    )}
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

      {!loading && locationOptions.length > 0 && categoryOptions.length > 0 && (
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
              <Form.Item label="分类">
                <Selector
                  options={categoryOptions}
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
    </Layout>
  );
}

function InboundDenied() {
  return (
    <Layout title="入库">
      <SectionCard>
        <EmptyState icon="🔒" text="暂无入库权限" hint="入库操作需要库管员或管理员角色" />
      </SectionCard>
    </Layout>
  );
}

export default function InboundPage() {
  return (
    <AuthGate roles={["KEEPER", "ADMIN"]} fallback={<InboundDenied />}>
      <InboundForm />
    </AuthGate>
  );
}
