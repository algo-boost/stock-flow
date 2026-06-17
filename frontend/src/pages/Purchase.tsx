import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Form, Input, SearchBar, Selector, Stepper, TextArea, Toast } from "antd-mobile";
import { useNavigate, useSearchParams } from "react-router-dom";
import { getMaterial, listLocations, postPurchaseInbound, searchMaterials } from "../api";
import type { MaterialDetail, MaterialSearchItem } from "../api/types";
import { AuthGate } from "../components/AuthGate";
import { CacheRefreshButton } from "../components/CacheRefreshButton";
import { Layout } from "../components/Layout";
import { EmptyState, PageHero, SectionCard } from "../components/ui";

function newIdempotencyKey() {
  return crypto.randomUUID();
}

function PurchaseContent() {
  const pageSize = 20;
  const [params] = useSearchParams();
  const presetMaterialId = params.get("material_id") ?? "";
  const navigate = useNavigate();
  const [items, setItems] = useState<MaterialSearchItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [locationOptions, setLocationOptions] = useState<{ label: string; value: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [selected, setSelected] = useState<MaterialDetail | null>(null);
  const [locationId, setLocationId] = useState("");
  const [qty, setQty] = useState(1);
  const [supplier, setSupplier] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loadMaterials = useCallback(async (q = "", nextPage = 1, append = false) => {
    setLoading(true);
    try {
      const data = await searchMaterials(q, { page: nextPage, size: pageSize });
      setItems((current) => (append ? [...current, ...data.items] : data.items));
      setPage(data.page);
      setTotal(data.total);
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "加载物料失败" });
    } finally {
      setLoading(false);
    }
  }, []);

  const loadLocations = useCallback(async () => {
    try {
      const locs = await listLocations();
      setLocationOptions(locs.map((loc) => ({ label: `${loc.name}（${loc.code}）`, value: loc.id })));
      setLocationId((current) => current || locs[0]?.id || "");
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
        setSupplier(detail.material.supplier ?? "");
        const defaultLoc = detail.material.default_location_id ?? detail.inventory[0]?.location_id ?? locationId;
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
      setSupplier(detail.material.supplier ?? "");
      const defaultLoc = detail.material.default_location_id ?? detail.inventory[0]?.location_id ?? locationId;
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
    setSupplier("");
    setNote("");
  };

  const onSearch = (val: string) => {
    setKeyword(val);
    void loadMaterials(val, 1);
  };

  const onSubmit = async () => {
    if (!selected || !canSubmit) {
      Toast.show({ content: "请填写物料、库位和数量" });
      return;
    }
    setSubmitting(true);
    try {
      const result = await postPurchaseInbound({
        material_id: selected.material.id,
        location_id: locationId,
        qty,
        idempotency_key: newIdempotencyKey(),
        supplier: supplier.trim() || undefined,
        note: note.trim() || undefined,
      });
      Toast.show({ icon: "success", content: `进货已入库 · ${result.transaction_id}` });
      navigate(`/materials/${selected.material.id}`);
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "进货失败" });
    } finally {
      setSubmitting(false);
    }
  };

  if (selected) {
    const m = selected.material;
    const isLowStock = selected.total_quantity < (m.min_stock ?? 5);
    return (
      <Layout title="进货">
        <PageHero
          title="管理员进货"
          subtitle={`${m.name} · 当前总库存 ${selected.total_quantity} ${m.unit}`}
          extra={<CacheRefreshButton onRefreshed={() => loadMaterials(keyword, 1)} />}
        />
        {isLowStock && (
          <div className="low-stock-alert">
            当前库存低于安全库存 {m.min_stock ?? 5}，建议优先补货。
          </div>
        )}
        <SectionCard title="进货单" subtitle="仅记录补货入库和供货商，不管理采购价格或付款">
          <button type="button" className="back-link" onClick={backToList}>
            ← 返回物料列表
          </button>
          <div className="material-selected" style={{ marginTop: 12 }}>
            <div>
              <div className="material-selected-name">{m.name}</div>
              <div className="material-selected-code">
                {m.code}
                {m.supplier ? ` · 当前供货商：${m.supplier}` : ""}
              </div>
            </div>
            <span className={isLowStock ? "stock-badge stock-badge-warning" : "stock-badge"}>
              总库存 {selected.total_quantity}
            </span>
          </div>
          <Form layout="vertical" className="form-card">
            <Form.Item label="目标库位">
              <Selector
                options={locationOptions}
                value={locationId ? [locationId] : []}
                onChange={(arr) => setLocationId(arr[0] ?? "")}
              />
            </Form.Item>
            {locationId && selectedStock !== null && <div className="stock-hint">该库位当前库存：{selectedStock}</div>}
            <Form.Item label="进货数量">
              <Stepper min={1} value={qty} onChange={setQty} />
            </Form.Item>
            <Form.Item label="供货商">
              <Input value={supplier} onChange={setSupplier} placeholder="如：XX 电子 / 官方旗舰店" />
            </Form.Item>
            <Form.Item label="备注">
              <TextArea value={note} onChange={setNote} placeholder="采购单号 / 到货说明（可选）" rows={3} />
            </Form.Item>
          </Form>
        </SectionCard>
        <div className="actions single">
          <Button color="primary" loading={submitting} disabled={!canSubmit} onClick={onSubmit}>
            确认进货入库
          </Button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="进货">
      <PageHero
        title="管理员进货"
        subtitle="选择物料后填写库位、数量和供货商，提交后库存自动增加"
        extra={<CacheRefreshButton onRefreshed={() => loadMaterials(keyword, 1)} />}
      />
      <SectionCard title="选择物料" subtitle={loading && items.length === 0 ? "正在同步…" : `共 ${total} 种物料`}>
        <SearchBar
          placeholder="搜索名称 / 编码 / 条码 / 分类 / 供货商"
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
          <EmptyState icon="📦" text={keyword ? "没有匹配的物料" : "暂无物料"} hint="请先在入库页或 Bitable 维护物料主数据" />
        ) : (
          <div className="catalog-list">
            {items.map((item) => {
              const isLowStock = item.total_quantity < (item.min_stock ?? 5);
              return (
                <button key={item.id} type="button" className="catalog-row" onClick={() => selectMaterial(item)}>
                  <div className="catalog-row-main">
                    <div className="catalog-row-name">{item.name}</div>
                    <div className="catalog-row-meta">
                      <span className="chip">{item.code}</span>
                      {(item.major_category || item.category_name) && (
                        <span className="chip chip-muted">{item.major_category ?? item.category_name}</span>
                      )}
                      {item.supplier && <span className="chip chip-muted">{item.supplier}</span>}
                    </div>
                    <div className="catalog-row-locs">{item.locations_summary ?? "暂无库存"}</div>
                  </div>
                  <div className="catalog-row-right">
                    <span className={isLowStock ? "stock-badge stock-badge-warning" : "stock-badge"}>
                      {isLowStock ? `缺货 ${item.total_quantity}` : item.total_quantity}
                    </span>
                    <span className="material-card-arrow">›</span>
                  </div>
                </button>
              );
            })}
            {hasMore && (
              <div className="load-more">
                <Button loading={loading} fill="outline" block onClick={() => loadMaterials(keyword, page + 1, true)}>
                  加载更多
                </Button>
              </div>
            )}
          </div>
        )}
      </SectionCard>
    </Layout>
  );
}

export default function PurchasePage() {
  return (
    <AuthGate
      roles={["ADMIN"]}
      fallback={
        <Layout title="进货">
          <EmptyState icon="🔒" text="权限不足" hint="仅管理员可访问进货功能" />
        </Layout>
      }
    >
      <PurchaseContent />
    </AuthGate>
  );
}
