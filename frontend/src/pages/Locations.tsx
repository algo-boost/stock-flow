import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Tabs, Toast } from "antd-mobile";
import { useNavigate, useSearchParams } from "react-router-dom";
import { deleteLocation, listInventory, listLocations } from "../api";
import type { InventoryItem, Location } from "../api/types";
import { AuthGate } from "../components/AuthGate";
import { Layout } from "../components/Layout";
import { LocationTransferPanel } from "../components/LocationTransferPanel";
import { EmptyState, PageHero, SectionCard } from "../components/ui";

function LocationManagePanel() {
  const navigate = useNavigate();
  const [locations, setLocations] = useState<Location[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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
      Toast.show({ icon: "success", content: "库位已删除" });
      await loadData();
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "删除库位失败" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard
      title={loading ? "加载中…" : `现有库位 ${locations.length} 个`}
      subtitle="库存不为 0 的库位不能删除"
    >
      <div className="actions single" style={{ marginBottom: 12 }}>
        <Button block color="primary" onClick={() => navigate("/locations/new")}>
          新增库位
        </Button>
      </div>
      {locations.length === 0 && !loading ? (
        <EmptyState icon="📍" text="暂无库位" hint="点击右上角「新增库位」创建货柜或暂存区" />
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
                  <Button size="mini" fill="outline" onClick={() => navigate(`/locations/${location.id}/edit`)}>
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
  );
}

function LocationsManager() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") === "transfer" ? "transfer" : "manage";

  const onTabChange = (key: string) => {
    const next = new URLSearchParams(searchParams);
    if (key === "transfer") {
      next.set("tab", "transfer");
    } else {
      next.delete("tab");
      next.delete("material_id");
    }
    setSearchParams(next, { replace: true });
  };

  return (
    <Layout title="库位管理">
      <PageHero title="库位管理" subtitle="维护货柜与货架，以及库内移动、暂存上架" />

      <Tabs activeKey={activeTab} onChange={onTabChange}>
        <Tabs.Tab title="库位维护" key="manage">
          <LocationManagePanel />
        </Tabs.Tab>
        <Tabs.Tab title="库内移动" key="transfer">
          <LocationTransferPanel />
        </Tabs.Tab>
      </Tabs>
    </Layout>
  );
}

function LocationsDenied() {
  return (
    <Layout title="库位管理">
      <SectionCard>
        <EmptyState icon="🔒" text="暂无库位维护权限" hint="库位维护与库内移动需要库管员或管理员角色" />
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
