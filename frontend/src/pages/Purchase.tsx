import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Form, Input, SearchBar, Selector, Stepper, TextArea, Toast } from "antd-mobile";
import { useNavigate, useSearchParams } from "react-router-dom";
import { getMaterial, listLocations, postPurchaseInbound, searchMaterials } from "../api";
import type { MaterialDetail, MaterialSearchItem } from "../api/types";
import { useLiveListData } from "../utils/dataMutation";
import { AuthGate } from "../components/AuthGate";
import { Layout } from "../components/Layout";
import { EmptyState, PageHeader, SectionCard } from "../components/ui";
import { openMaterialDetail } from "../utils/detailNavigation";
import { newIdempotencyKey } from "../utils/idempotency";

/** 纯内容，不含 Layout，可嵌入其他页面 */
export function PurchaseForm() {
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

  const reloadPageData = useCallback(() => {
    void loadMaterials("", 1);
    void loadLocations();
  }, [loadLocations, loadMaterials]);

  useLiveListData(reloadPageData, { scopes: ["locations", "materials", "inventory"] });

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
      await postPurchaseInbound({
        material_id: selected.material.id,
        location_id: locationId,
        qty,
        idempotency_key: newIdempotencyKey(),
        supplier: supplier.trim() || undefined,
        note: note.trim() || undefined,
      });
      Toast.show({ icon: "success", content: "进货已入库" });
      openMaterialDetail(navigate, selected.material.id, {
        backTo: `/purchase?material_id=${selected.material.id}`,
      });
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
      <>
        <PageHeader
          title={m.name}
          subtitle={`库存 ${selected.total_quantity} ${m.unit}`}
        />
        {isLowStock && <div className="low-stock-alert">低于安全库存 {m.min_stock ?? 5}</div>}
        <SectionCard title="进货单">
          <button type="button" className="back-link" onClick={backToList}>
            ← 返回列表
          </button>
          <Form layout="vertical" className="form-card">
            <Form.Item label="目标库位">
              <Selector
                options={locationOptions}
                value={locationId ? [locationId] : []}
                onChange={(arr) => setLocationId(arr[0] ?? "")}
              />
            </Form.Item>
            {locationId && selectedStock !== null && (
              <div className="stock-hint">该库位库存：{selectedStock}</div>
            )}
            <Form.Item label="数量">
              <Stepper min={1} value={qty} onChange={setQty} />
            </Form.Item>
            <Form.Item label="供货商">
              <Input value={supplier} onChange={setSupplier} placeholder="供货商（可选）" />
            </Form.Item>
            <Form.Item label="备注">
              <TextArea value={note} onChange={setNote} placeholder="采购单号等（可选）" rows={2} />
            </Form.Item>
          </Form>
        </SectionCard>
        <div className="actions single">
          <Button color="primary" loading={submitting} disabled={!canSubmit} onClick={onSubmit}>
            确认进货
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="进货补货" subtitle="采购到货后直接增加库存" />
      <SectionCard title={loading && items.length === 0 ? "加载中…" : `物料 ${total} 种`}>
        <SearchBar
          placeholder="搜索物料"
          value={keyword}
          onChange={setKeyword}
          onSearch={onSearch}
          onClear={() => {
            setKeyword("");
            void loadMaterials("", 1);
          }}
        />
        {loading && items.length === 0 ? (
          <EmptyState loading text="加载中…" />
        ) : items.length === 0 ? (
          <EmptyState icon="package" text={keyword ? "无匹配" : "暂无物料"} />
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
                    </div>
                  </div>
                  <span className={isLowStock ? "stock-badge stock-badge-warning" : "stock-badge"}>
                    {item.total_quantity}
                  </span>
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
    </>
  );
}

export default function PurchasePage() {
  const [params] = useSearchParams();
  const fromHome = params.get("from") === "home";
  const backTo = fromHome ? "/" : "/manage?tab=dashboard";

  return (
    <AuthGate
      roles={["ADMIN"]}
      fallback={
        <Layout title="进货" backTo="/">
          <EmptyState icon="lock" text="权限不足" hint="仅管理员可进货" />
        </Layout>
      }
    >
      <Layout title="进货" backTo={backTo}>
        <PurchaseForm />
      </Layout>
    </AuthGate>
  );
}
