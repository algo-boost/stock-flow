import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Dialog, Tabs, Toast } from "antd-mobile";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  deleteLocation,
  listInventory,
  listLocations,
} from "../api";
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
      const [locs, inv] = await Promise.all([
        listLocations(),
        listInventory(),
      ]);
      setLocations(locs);
      setInventory(inv);
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "加载库位失败" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  const stockByLocation = useMemo(() => {
    const result = new Map<string, number>();
    for (const item of inventory) {
      result.set(item.location_id, (result.get(item.location_id) ?? 0) + item.quantity);
    }
    return result;
  }, [inventory]);

  const onDelete = async (loc: Location) => {
    const stock = stockByLocation.get(loc.id) ?? 0;
    if (stock > 0) { Toast.show({ icon: "fail", content: `库存 ${stock}，不能删除` }); return; }
    const confirmed = await Dialog.confirm({ content: `删除「${loc.name}」？其子库位也会被删除。` });
    if (!confirmed) return;
    setSaving(true);
    try { await deleteLocation(loc.id); Toast.show({ icon: "success", content: "已删除" }); await loadData(); }
    catch (e) { Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "删除失败" }); }
    finally { setSaving(false); }
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <Button color="primary" onClick={() => navigate("/locations/new")}>
          + 新增库位
        </Button>
      </div>

      <SectionCard title={loading ? "加载中…" : `现有库位 ${locations.length} 个`} subtitle="库存不为 0 的库位不能删除">
        {locations.length === 0 && !loading ? (
          <EmptyState icon="📍" text="暂无库位" hint="点击上方按钮新增库位" />
        ) : (
          <div className="location-list">
            {locations.map((loc) => {
              const stock = stockByLocation.get(loc.id) ?? 0;
              return (
                <div className="location-card location-manage-card" key={loc.id}>
                  <div className="location-card-main">
                    <div className="location-name">
                      {loc.parent_id && <span style={{ color: "#999" }}>├ </span>}
                      {loc.name}
                    </div>
                    <div className="location-meta">
                      <span className="chip">{loc.code}</span>
                      <span className="chip chip-muted">{loc.type}</span>
                      {[loc.major_name, loc.mid_name, loc.sub_name].filter(Boolean).length > 0 && (
                        <span className="chip chip-muted">
                          {[loc.major_name, loc.mid_name, loc.sub_name].filter(Boolean).join(" › ")}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="location-card-actions">
                    <span className="stock-badge">库存 {stock}</span>
                    <Button size="mini" fill="outline" onClick={() => navigate(`/locations/${loc.id}/edit`)}>编辑</Button>
                    <Button size="mini" color="danger" fill="outline" disabled={stock > 0 || saving} onClick={() => onDelete(loc)}>删除</Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

    </>
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
