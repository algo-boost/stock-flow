import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Form, SearchBar, Selector, Stepper, TextArea, Toast } from "antd-mobile";
import { useSearchParams } from "react-router-dom";
import { getMaterialCatalog, postOutbound } from "../api";
import type { MaterialDetail } from "../api/types";
import { CacheRefreshButton } from "../components/CacheRefreshButton";
import { useAuth } from "../components/AuthGate";
import { Layout } from "../components/Layout";
import { EmptyState, PageHero, SectionCard } from "../components/ui";

function newIdempotencyKey() {
  return crypto.randomUUID();
}

function filterCatalog(items: MaterialDetail[], keyword: string): MaterialDetail[] {
  const k = keyword.trim().toLowerCase();
  if (!k) return items;
  return items.filter(({ material: m }) => {
    return (
      m.name.toLowerCase().includes(k) ||
      m.code.toLowerCase().includes(k) ||
      (m.barcode?.toLowerCase().includes(k) ?? false) ||
      (m.category_name?.toLowerCase().includes(k) ?? false)
    );
  });
}

function applyLocalOutbound(
  items: MaterialDetail[],
  materialId: string,
  locationId: string,
  qty: number,
): MaterialDetail[] {
  return items
    .map((item) => {
      if (item.material.id !== materialId) return item;
      const inventory = item.inventory
        .map((inv) =>
          inv.location_id === locationId
            ? { ...inv, quantity: Math.max(0, inv.quantity - qty) }
            : inv,
        )
        .filter((inv) => inv.quantity > 0);
      const total = inventory.reduce((sum, inv) => sum + inv.quantity, 0);
      return { ...item, inventory, total_quantity: total };
    })
    .filter((item) => item.total_quantity > 0);
}

export default function OutboundPage() {
  const [params] = useSearchParams();
  const presetMaterialId = params.get("material_id") ?? "";

  const [catalog, setCatalog] = useState<MaterialDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [selected, setSelected] = useState<MaterialDetail | null>(null);
  const [locationId, setLocationId] = useState("");
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { canInbound } = useAuth();

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getMaterialCatalog({ stockOnly: true });
      setCatalog(data);
      if (presetMaterialId) {
        const hit = data.find((d) => d.material.id === presetMaterialId);
        if (hit) {
          setSelected(hit);
          setLocationId(hit.inventory[0]?.location_id ?? "");
          setQty(1);
          setNote("");
        }
      }
    } catch (e) {
      Toast.show({
        icon: "fail",
        content: e instanceof Error ? e.message : "加载 Bitable 物料失败",
      });
    } finally {
      setLoading(false);
    }
  }, [presetMaterialId]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const filtered = useMemo(() => filterCatalog(catalog, keyword), [catalog, keyword]);

  const selectMaterial = (item: MaterialDetail) => {
    setSelected(item);
    const first = item.inventory[0];
    setLocationId(first?.location_id ?? "");
    setQty(1);
    setNote("");
  };

  const backToList = () => {
    setSelected(null);
    setLocationId("");
    setQty(1);
    setNote("");
  };

  const locationOptions = useMemo(
    () =>
      (selected?.inventory ?? []).map((inv) => ({
        label: `${inv.location_name ?? inv.location_id}（可用 ${inv.quantity}）`,
        value: inv.location_id,
      })),
    [selected],
  );

  const maxQty = selected?.inventory.find((i) => i.location_id === locationId)?.quantity ?? 0;

  const canSubmit = Boolean(selected && locationId && qty > 0 && qty <= maxQty && note.trim());

  const onSubmit = async () => {
    if (!selected || !canSubmit) {
      Toast.show({ content: "请填写完整出库信息" });
      return;
    }
    setSubmitting(true);
    try {
      const result = await postOutbound({
        material_id: selected.material.id,
        location_id: locationId,
        qty,
        idempotency_key: newIdempotencyKey(),
        note: note.trim(),
      });
      Toast.show({ icon: "success", content: `出库成功 ${result.transaction_id}` });
      setCatalog((items) => applyLocalOutbound(items, selected.material.id, locationId, qty));
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
      <Layout title="出库">
        <PageHero title="确认出库" subtitle={`${m.name} · 库存 ${selected.total_quantity} ${m.unit}`} />

        <SectionCard title="出库信息" subtitle="用途必填，便于追溯">
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

          {locationOptions.length === 0 ? (
            <EmptyState icon="🏷️" text="该物料暂无库存" hint="请联系库管入库" />
          ) : (
            <Form layout="vertical" className="form-card">
              <Form.Item label="出库库位">
                <Selector
                  options={locationOptions}
                  value={locationId ? [locationId] : []}
                  onChange={(arr) => setLocationId(arr[0] ?? "")}
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
            </Form>
          )}
        </SectionCard>

        <div className="actions single">
          <Button color="primary" loading={submitting} disabled={!canSubmit} onClick={onSubmit}>
            确认出库
          </Button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="出库">
      <PageHero
        title="出库领用"
        subtitle="数据来自 Bitable 物料表 · 仅显示有库存的物料"
        extra={canInbound ? <CacheRefreshButton onRefreshed={loadCatalog} /> : undefined}
      />

      <SectionCard title="物料列表" subtitle={loading ? "正在同步…" : `共 ${catalog.length} 种可出库`}>
        <SearchBar
          placeholder="搜索名称 / 编码 / 条码 / 分类"
          value={keyword}
          onChange={setKeyword}
          onSearch={setKeyword}
        />
        <div className="catalog-meta">
          {loading ? "加载中…" : `显示 ${filtered.length} 条${keyword ? "（已筛选）" : ""}`}
        </div>

        {loading ? (
          <EmptyState icon="⏳" text="正在从 Bitable 拉取物料…" />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="📦"
            text={keyword ? "没有匹配的物料" : "暂无可出库物料"}
            hint={keyword ? "换个关键词试试" : "请先在 Bitable 维护库存"}
          />
        ) : (
          <div className="catalog-list">
            {filtered.map((item) => (
              <button
                key={item.material.id}
                type="button"
                className="catalog-row"
                onClick={() => selectMaterial(item)}
              >
                <div className="catalog-row-main">
                  <div className="catalog-row-name">{item.material.name}</div>
                  <div className="catalog-row-meta">
                    <span className="chip">{item.material.code}</span>
                    {item.material.category_name && (
                      <span className="chip chip-muted">{item.material.category_name}</span>
                    )}
                    <span className="chip chip-muted">{item.material.unit}</span>
                  </div>
                  <div className="catalog-row-locs">
                    {item.inventory
                      .map((i) => `${i.location_name ?? i.location_id} ${i.quantity}`)
                      .join(" · ")}
                  </div>
                </div>
                <div className="catalog-row-right">
                  <span className="stock-badge">{item.total_quantity}</span>
                  <span className="material-card-arrow">›</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </SectionCard>
    </Layout>
  );
}
