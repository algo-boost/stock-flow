import { useCallback, useEffect, useState } from "react";
import { Button, Form, Input, Selector, Toast } from "antd-mobile";
import { useNavigate, useParams } from "react-router-dom";
import { createLocation, listLocationTypes, listLocations, updateLocation } from "../api";
import type { Location } from "../api/types";
import { AuthGate } from "../components/AuthGate";
import { Layout } from "../components/Layout";
import { EmptyState, SectionCard } from "../components/ui";

function emptyForm() {
  return { code: "", name: "", type: "货柜", parent_id: "" };
}

function LocationFormContent() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = Boolean(id);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [allLocations, setAllLocations] = useState<Location[]>([]);
  const [locationTypes, setLocationTypes] = useState<string[]>(["货柜", "货架", "专用螺栓架", "工具架", "快递暂存"]);

  const loadMeta = useCallback(async () => {
    try {
      const [locs, types] = await Promise.all([
        listLocations(),
        listLocationTypes().catch(() => [] as string[]),
      ]);
      setAllLocations(locs);
      if (types.length) setLocationTypes(types);
    } catch { /* 降级使用默认类型 */ }
  }, []);

  useEffect(() => { void loadMeta(); }, [loadMeta]);

  useEffect(() => {
    if (!id) { setLoading(false); return; }
    void (async () => {
      setLoading(true);
      try {
        // loadMeta 已经加载了所有库位数据，从这里找要编辑的库位
        const locs = allLocations.length > 0 ? allLocations : await listLocations();
        const location = locs.find((item) => item.id === id);
        if (!location) {
          Toast.show({ icon: "fail", content: "库位不存在或已删除" });
          navigate("/locations", { replace: true });
          return;
        }
        setForm({
          code: location.code,
          name: location.name,
          type: location.type || "货柜",
          parent_id: location.parent_id ?? "",
        });
      } catch (e) {
        Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "加载库位失败" });
        navigate("/locations", { replace: true });
      } finally {
        setLoading(false);
      }
    })();
  }, [id, navigate, allLocations]);

  // 父库位选项（排除自身和子库位，避免循环引用）
  const parentOptions = [
    { label: "无（顶层）", value: "" },
    ...allLocations
      .filter((l) => l.id !== id)
      .map((l) => ({ label: `${l.code} ${l.name}`, value: l.id })),
  ];

  const onSubmit = async () => {
    if (!form.code.trim() || !form.name.trim()) {
      Toast.show({ content: "请填写库位编号和名称" });
      return;
    }
    setSaving(true);
    try {
      const payload: { code: string; name: string; type: string; parent_id?: string } = {
        code: form.code.trim(),
        name: form.name.trim(),
        type: form.type.trim() || "货柜",
      };
      if (form.parent_id) {
        payload.parent_id = form.parent_id;
      }
      if (isEdit && id) {
        await updateLocation(id, payload);
        Toast.show({ icon: "success", content: "库位已更新" });
      } else {
        await createLocation(payload);
        Toast.show({ icon: "success", content: "库位已新增" });
      }
      navigate("/locations", { replace: true });
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "保存库位失败" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Layout title={isEdit ? "编辑库位" : "新增库位"}>
        <SectionCard>
          <EmptyState icon="⏳" text="加载中…" />
        </SectionCard>
      </Layout>
    );
  }

  return (
    <Layout title={isEdit ? "编辑库位" : "新增库位"}>
      <SectionCard title={isEdit ? "编辑库位" : "新增库位"} subtitle="仅库管 / 管理员可操作">
        <Form layout="vertical" className="form-card">
          <Form.Item label="库位编号">
            <Input value={form.code} onChange={(code) => setForm((v) => ({ ...v, code }))} placeholder="如 A-柜-01" />
          </Form.Item>
          <Form.Item label="库位名称">
            <Input value={form.name} onChange={(name) => setForm((v) => ({ ...v, name }))} placeholder="如 A区货柜-01" />
          </Form.Item>
          <Form.Item label="库位类型">
            <Selector
              options={locationTypes.map((t) => ({ label: t, value: t }))}
              value={form.type ? [form.type] : []}
              onChange={(arr) => setForm((v) => ({ ...v, type: arr[0] ?? "货柜" }))}
            />
          </Form.Item>
          <Form.Item label="父库位（可选）">
            <Selector
              options={parentOptions}
              value={form.parent_id ? [form.parent_id] : [""]}
              onChange={(arr) => setForm((v) => ({ ...v, parent_id: arr[0] ?? "" }))}
            />
          </Form.Item>
        </Form>
        <div className="actions two">
          <Button disabled={saving} onClick={() => navigate("/locations")}>
            取消
          </Button>
          <Button color="primary" loading={saving} onClick={onSubmit}>
            {isEdit ? "保存修改" : "新增库位"}
          </Button>
        </div>
      </SectionCard>
    </Layout>
  );
}

function LocationFormDenied() {
  return (
    <Layout title="库位管理">
      <SectionCard>
        <EmptyState icon="🔒" text="暂无库位维护权限" hint="库位维护需要库管员或管理员角色" />
      </SectionCard>
    </Layout>
  );
}

export default function LocationFormPage() {
  return (
    <AuthGate roles={["KEEPER", "ADMIN"]} fallback={<LocationFormDenied />}>
      <LocationFormContent />
    </AuthGate>
  );
}
