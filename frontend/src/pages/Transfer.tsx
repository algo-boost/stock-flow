import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Form, SearchBar, Selector, Stepper, TextArea, Toast } from "antd-mobile";
import { useSearchParams } from "react-router-dom";
import { getMaterial, listLocations, postTransfer, searchMaterials } from "../api";
import type { Location, MaterialDetail, MaterialSearchItem } from "../api/types";
import { AuthGate } from "../components/AuthGate";
import { CacheRefreshButton } from "../components/CacheRefreshButton";
import { Layout } from "../components/Layout";
import { EmptyState, PageHero, SectionCard } from "../components/ui";

function newIdempotencyKey() {
  return crypto.randomUUID();
}

function TransferForm() {
  const pageSize = 20;
  const [params] = useSearchParams();
  const presetMaterialId = params.get("material_id") ?? "";
  const [items, setItems] = useState<MaterialSearchItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [selected, setSelected] = useState<MaterialDetail | null>(null);
  const [fromLocationId, setFromLocationId] = useState("");
  const [toLocationId, setToLocationId] = useState("");
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
        setFromLocationId(first?.location_id ?? "");
        setToLocationId(locations.find((loc) => loc.id !== first?.location_id)?.id ?? "");
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
        label: `${inv.location_name ?? inv.location_id}（可用 ${inv.quantity}）`,
        value: inv.location_id,
      })),
    [selected],
  );

  const maxQty = selected?.inventory.find((inv) => inv.location_id === fromLocationId)?.quantity ?? 0;
  const canSubmit = Boolean(
    selected &&
      fromLocationId &&
      toLocationId &&
      fromLocationId !== toLocationId &&
      qty > 0 &&
      qty <= maxQty,
  );

  const selectMaterial = async (item: MaterialSearchItem) => {
    setLoading(true);
    try {
      const detail = await getMaterial(item.id);
      const first = detail.inventory[0];
      setSelected(detail);
      setFromLocationId(first?.location_id ?? "");
      setToLocationId(locations.find((loc) => loc.id !== first?.location_id)?.id ?? "");
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
    setFromLocationId("");
    setToLocationId("");
    setQty(1);
    setNote("");
  };

  const onSubmit = async () => {
    if (!selected || !canSubmit) {
      Toast.show({ content: "请填写完整移动信息" });
      return;
    }
    setSubmitting(true);
    try {
      const result = await postTransfer({
        material_id: selected.material.id,
        from_location_id: fromLocationId,
        to_location_id: toLocationId,
        qty,
        idempotency_key: newIdempotencyKey(),
        note: note.trim() || undefined,
      });
      Toast.show({ icon: "success", content: `移动成功 ${result.transaction_ids.length} 条流水` });
      backToList();
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "移动失败" });
    } finally {
      setSubmitting(false);
    }
  };

  if (selected) {
    return (
      <Layout title="库内移动">
        <PageHero
          title="确认移动"
          subtitle={`${selected.material.name} · 总库存 ${selected.total_quantity} ${selected.material.unit}`}
          extra={<CacheRefreshButton onRefreshed={() => loadMaterials(keyword, 1)} />}
        />
        <SectionCard title="移动信息" subtitle="移动不改变总库存，只调整库位分布">
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
            <Form.Item label="源库位">
              <Selector
                options={sourceOptions}
                value={fromLocationId ? [fromLocationId] : []}
                onChange={(arr) => {
                  const next = arr[0] ?? "";
                  setFromLocationId(next);
                  if (next === toLocationId) {
                    setToLocationId(locations.find((loc) => loc.id !== next)?.id ?? "");
                  }
                  setQty(1);
                }}
              />
            </Form.Item>
            <Form.Item label="目标库位">
              <Selector
                options={locationOptions.filter((option) => option.value !== fromLocationId)}
                value={toLocationId ? [toLocationId] : []}
                onChange={(arr) => setToLocationId(arr[0] ?? "")}
              />
            </Form.Item>
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
      </Layout>
    );
  }

  return (
    <Layout title="库内移动">
      <PageHero
        title="库内移动"
        subtitle="默认分页显示有库存物料，用于暂存上架和库位整理"
        extra={<CacheRefreshButton onRefreshed={() => loadMaterials(keyword, 1)} />}
      />
      <SectionCard title="选择物料" subtitle={loading && items.length === 0 ? "正在同步…" : `共 ${total} 种有库存物料`}>
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
          <EmptyState icon="📦" text={keyword ? "没有匹配的物料" : "暂无可移动物料"} />
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
    </Layout>
  );
}

function TransferDenied() {
  return (
    <Layout title="库内移动">
      <SectionCard>
        <EmptyState icon="🔒" text="暂无移动权限" hint="库内移动需要库管员或管理员角色" />
      </SectionCard>
    </Layout>
  );
}

export default function TransferPage() {
  return (
    <AuthGate roles={["KEEPER", "ADMIN"]} fallback={<TransferDenied />}>
      <TransferForm />
    </AuthGate>
  );
}
