import { useEffect, useState } from "react";
import { Button, Form, Input, Selector, Toast } from "antd-mobile";
import { useNavigate, useParams } from "react-router-dom";
import { createLocation, listLocations, updateLocation } from "../api";
import { AuthGate } from "../components/AuthGate";
import { Layout } from "../components/Layout";
import { EmptyState, SectionCard } from "../components/ui";

const LOCATION_TYPES = ["货柜", "货架", "专用螺栓架", "工具架", "快递暂存"];

function emptyForm() {
  return { code: "", name: "", type: "货柜" };
}

function LocationFormContent() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = Boolean(id);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      setLoading(true);
      try {
        const locations = await listLocations();
        const location = locations.find((item) => item.id === id);
        if (!location) {
          Toast.show({ icon: "fail", content: "库位不存在或已删除" });
          navigate("/locations", { replace: true });
          return;
        }
        setForm({ code: location.code, name: location.name, type: location.type || "货柜" });
      } catch (e) {
        Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "加载库位失败" });
        navigate("/locations", { replace: true });
      } finally {
        setLoading(false);
      }
    })();
  }, [id, navigate]);

  const onSubmit = async () => {
    if (!form.code.trim() || !form.name.trim()) {
      Toast.show({ content: "请填写库位编号和名称" });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        code: form.code.trim(),
        name: form.name.trim(),
        type: form.type.trim() || "货柜",
      };
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
              options={LOCATION_TYPES.map((type) => ({ label: type, value: type }))}
              value={form.type ? [form.type] : []}
              onChange={(arr) => setForm((v) => ({ ...v, type: arr[0] ?? "货柜" }))}
            />
          </Form.Item>
        </Form>
        <div className="actions two">
          <Button disabled={saving} onClick={() => navigate(-1)}>
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
