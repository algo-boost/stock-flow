import { useEffect, useMemo, useState } from "react";
import { Button, Form, Selector, Stepper, TextArea, Toast } from "antd-mobile";
import { useNavigate, useSearchParams } from "react-router-dom";
import { getMaterialCatalog, listLocations, postInbound } from "../api";
import type { MaterialDetail } from "../api/types";
import { AuthGate } from "../components/AuthGate";
import { Layout } from "../components/Layout";
import { EmptyState, PageHero, SectionCard } from "../components/ui";

function newIdempotencyKey() {
  return crypto.randomUUID();
}

function InboundForm() {
  const [params] = useSearchParams();
  const presetMaterialId = params.get("material_id") ?? "";
  const navigate = useNavigate();

  const [catalog, setCatalog] = useState<MaterialDetail[]>([]);
  const [locationOptions, setLocationOptions] = useState<{ label: string; value: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [materialId, setMaterialId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([getMaterialCatalog(), listLocations()])
      .then(([materials, locs]) => {
        setCatalog(materials);
        setLocationOptions(
          locs.map((loc) => ({
            label: `${loc.name}（${loc.code}）`,
            value: loc.id,
          })),
        );
        if (presetMaterialId) {
          setMaterialId(presetMaterialId);
          const hit = materials.find((m) => m.material.id === presetMaterialId);
          const defaultLoc =
            hit?.material.default_location_id ?? hit?.inventory[0]?.location_id ?? locs[0]?.id;
          if (defaultLoc) setLocationId(defaultLoc);
        } else if (locs[0]) {
          setLocationId(locs[0].id);
        }
      })
      .catch((e) => {
        Toast.show({
          icon: "fail",
          content: e instanceof Error ? e.message : "加载 Bitable 数据失败",
        });
      })
      .finally(() => setLoading(false));
  }, [presetMaterialId]);

  const materialOptions = useMemo(
    () =>
      catalog.map(({ material: m }) => ({
        label: `${m.name}（${m.code}）`,
        value: m.id,
      })),
    [catalog],
  );

  const selectedItem = catalog.find((c) => c.material.id === materialId);

  const currentStock = useMemo(() => {
    if (!selectedItem || !locationId) return null;
    return selectedItem.inventory.find((i) => i.location_id === locationId)?.quantity ?? 0;
  }, [selectedItem, locationId]);

  const onMaterialChange = (arr: string[]) => {
    const next = arr[0] ?? "";
    setMaterialId(next);
    const item = catalog.find((c) => c.material.id === next);
    const defaultLoc =
      item?.material.default_location_id ?? item?.inventory[0]?.location_id ?? locationId;
    if (defaultLoc) setLocationId(defaultLoc);
  };

  const canSubmit = Boolean(materialId && locationId && qty > 0 && !loading);

  const onSubmit = async () => {
    if (!canSubmit) {
      Toast.show({ content: "请填写物料、库位和数量" });
      return;
    }
    setSubmitting(true);
    try {
      const result = await postInbound({
        material_id: materialId,
        location_id: locationId,
        qty,
        idempotency_key: newIdempotencyKey(),
        note: note.trim() || undefined,
      });
      Toast.show({ icon: "success", content: `已同步 Bitable · ${result.transaction_id}` });
      navigate(`/materials/${materialId}`);
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "入库失败" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Layout title="入库">
      <PageHero
        title="入库上架"
        subtitle={loading ? "正在加载 Bitable…" : "填写信息后一键同步到多维表格"}
      />

      <SectionCard title="入库单" subtitle="库管 / 管理员">
        {loading ? (
          <EmptyState icon="⏳" text="正在从 Bitable 拉取物料与库位…" />
        ) : materialOptions.length === 0 ? (
          <EmptyState icon="📦" text="Bitable 暂无物料" hint="请先在多维表格维护物料表" />
        ) : locationOptions.length === 0 ? (
          <EmptyState icon="🏷️" text="Bitable 暂无库位" hint="请先在多维表格维护库位表" />
        ) : (
          <Form layout="vertical" className="form-card">
            <Form.Item label="物料">
              <Selector
                options={materialOptions}
                value={materialId ? [materialId] : []}
                onChange={onMaterialChange}
              />
            </Form.Item>
            <Form.Item label="目标库位">
              <Selector
                options={locationOptions}
                value={locationId ? [locationId] : []}
                onChange={(arr) => setLocationId(arr[0] ?? "")}
              />
            </Form.Item>
            {materialId && locationId && currentStock !== null && (
              <div className="stock-hint">该库位当前库存：{currentStock}</div>
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
        )}
      </SectionCard>

      <div className="actions single">
        <Button color="primary" loading={submitting} disabled={!canSubmit} onClick={onSubmit}>
          确认入库并同步
        </Button>
      </div>
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
