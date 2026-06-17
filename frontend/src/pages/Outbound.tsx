import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Form, SearchBar, Selector, Stepper, TextArea, Toast } from "antd-mobile";
import { useSearchParams } from "react-router-dom";
import { createStockRequest, getMaterial, postOutbound, searchMaterials } from "../api";
import type { MaterialDetail, MaterialSearchItem } from "../api/types";
import { CacheRefreshButton } from "../components/CacheRefreshButton";
import { useAuth } from "../components/AuthGate";
import { Layout } from "../components/Layout";
import { EmptyState, PageHero, SectionCard } from "../components/ui";

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

export default function OutboundPage() {
  const pageSize = 20;
  const [params] = useSearchParams();
  const presetMaterialId = params.get("material_id") ?? "";

  const [items, setItems] = useState<MaterialSearchItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [selected, setSelected] = useState<MaterialDetail | null>(null);
  const [locationId, setLocationId] = useState("");
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
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
    if (!presetMaterialId) return;
    void (async () => {
      try {
        const detail = await getMaterial(presetMaterialId);
        setSelected(detail);
        setLocationId(detail.inventory[0]?.location_id ?? "");
        setQty(1);
        setNote("");
      } catch (e) {
        Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "加载物料失败" });
      }
    })();
  }, [presetMaterialId]);

  const selectMaterial = async (item: MaterialSearchItem) => {
    setLoading(true);
    try {
      const detail = await getMaterial(item.id);
      setSelected(detail);
      const first = detail.inventory[0];
      setLocationId(first?.location_id ?? "");
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
      if (isDirectOutbound) {
        const result = await postOutbound({
          material_id: selected.material.id,
          location_id: locationId,
          qty,
          idempotency_key: newIdempotencyKey(),
          note: note.trim(),
        });
        Toast.show({ icon: "success", content: `出库成功 ${result.transaction_id}` });
        setItems((current) => applyLocalOutbound(current, selected.material.id, qty));
      } else {
        const result = await createStockRequest({
          type: "出库",
          material_id: selected.material.id,
          location_id: locationId,
          qty,
          idempotency_key: newIdempotencyKey(),
          note: note.trim(),
        });
        Toast.show({ icon: "success", content: `已提交出库申请 ${result.request_id}` });
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
      <Layout title={isDirectOutbound ? "出库" : "出库申请"}>
        <PageHero title="确认出库" subtitle={`${m.name} · 库存 ${selected.total_quantity} ${m.unit}`} />

        <SectionCard
          title={isDirectOutbound ? "出库信息" : "申请信息"}
          subtitle={isDirectOutbound ? "用途必填，便于追溯" : "提交后等待管理员审批，审批通过后再扣减库存"}
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
            {isDirectOutbound ? "确认出库" : "提交出库申请"}
          </Button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title={isDirectOutbound ? "出库" : "出库申请"}>
      <PageHero
        title={isDirectOutbound ? "出库领用" : "出库申请"}
        subtitle={isDirectOutbound ? "默认分页显示有库存物料，支持搜索后出库" : "普通用户提交申请，管理员审批通过后执行出库"}
        extra={canInbound ? <CacheRefreshButton onRefreshed={() => loadMaterials(keyword, 1)} /> : undefined}
      />

      <SectionCard title="物料列表" subtitle={loading && items.length === 0 ? "正在同步…" : `共 ${total} 种可出库`}>
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
            text={keyword ? "没有匹配的物料" : "暂无可出库物料"}
            hint={keyword ? "换个关键词试试" : "请先在 Bitable 维护库存"}
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
