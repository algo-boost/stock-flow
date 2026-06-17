import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Form, Input, Selector, Toast } from "antd-mobile";
import {
  createLocation,
  deleteLocation,
  listInventory,
  listLocations,
  updateLocation,
} from "../api";
import type { InventoryItem, Location } from "../api/types";
import { AuthGate } from "../components/AuthGate";
import { Layout } from "../components/Layout";
import { EmptyState, PageHero, SectionCard } from "../components/ui";

const LOCATION_TYPES = ["货柜", "货架", "专用螺栓架", "工具架", "快递暂存"];

function emptyForm() {
  return { code: "", name: "", type: "货柜" };
}

function LocationsManager() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [locs, inv] = await Promise.all([listLocations(), listInventory()]);
      setLocations(locs);
      setInventory(inv);
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "加载库位失败" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const stockByLocation = useMemo(() => {
    const result = new Map<string, number>();
    for (const item of inventory) {
      result.set(item.location_id, (result.get(item.location_id) ?? 0) + item.quantity);
    }
    return result;
  }, [inventory]);

  const resetForm = () => {
    setEditingId(null);
    setForm(emptyForm());
  };

  const startEdit = (location: Location) => {
    setEditingId(location.id);
    setForm({ code: location.code, name: location.name, type: location.type || "货柜" });
  };

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
      if (editingId) {
        await updateLocation(editingId, payload);
        Toast.show({ icon: "success", content: "库位已更新" });
      } else {
        await createLocation(payload);
        Toast.show({ icon: "success", content: "库位已新增" });
      }
      resetForm();
      await loadData();
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "保存库位失败" });
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (location: Location) => {
    const stock = stockByLocation.get(location.id) ?? 0;
    if (stock > 0) {
      Toast.show({ icon: "fail", content: `该库位仍有库存 ${stock}，请先移动或出库` });
      return;
    }
    if (!window.confirm(`确认删除库位「${location.name}」？删除后不可从系统中选择该库位。`)) {
      return;
    }
    setSaving(true);
    try {
      await deleteLocation(location.id);
      if (editingId === location.id) resetForm();
      Toast.show({ icon: "success", content: "库位已删除" });
      await loadData();
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "删除库位失败" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Layout title="库位管理">
      <PageHero title="库位管理" subtitle="维护货柜、货架、暂存区；删除前需先确保库位库存为 0" />

      <SectionCard title={editingId ? "编辑库位" : "新增库位"} subtitle="仅库管 / 管理员可操作">
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
          <Button disabled={saving} onClick={resetForm}>
            取消
          </Button>
          <Button color="primary" loading={saving} onClick={onSubmit}>
            {editingId ? "保存修改" : "新增库位"}
          </Button>
        </div>
      </SectionCard>

      <SectionCard title={loading ? "加载中…" : `现有库位 ${locations.length} 个`} subtitle="库存不为 0 的库位不能删除">
        {locations.length === 0 && !loading ? (
          <EmptyState icon="📍" text="暂无库位" hint="先新增一个货柜或暂存区" />
        ) : (
          <div className="location-list">
            {locations.map((location) => {
              const stock = stockByLocation.get(location.id) ?? 0;
              return (
                <div className="location-card location-manage-card" key={location.id}>
                  <div className="location-card-main">
                    <div className="location-name">{location.name}</div>
                    <div className="location-meta">
                      <span className="chip">{location.code}</span>
                      <span className="chip chip-muted">{location.type}</span>
                    </div>
                  </div>
                  <div className="location-card-actions">
                    <span className="stock-badge">库存 {stock}</span>
                    <Button size="mini" fill="outline" onClick={() => startEdit(location)}>
                      编辑
                    </Button>
                    <Button
                      size="mini"
                      color="danger"
                      fill="outline"
                      disabled={stock > 0 || saving}
                      onClick={() => onDelete(location)}
                    >
                      删除
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>
    </Layout>
  );
}

function LocationsDenied() {
  return (
    <Layout title="库位管理">
      <SectionCard>
        <EmptyState icon="🔒" text="暂无库位维护权限" hint="新增、改名和删除库位需要库管员或管理员角色" />
      </SectionCard>
    </Layout>
  );
}

export default function LocationsPage() {
  return (
    <AuthGate roles={["KEEPER", "ADMIN"]} fallback={<LocationsDenied />}>
      <LocationsManager />
    </AuthGate>
  );
}
