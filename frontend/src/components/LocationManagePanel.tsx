import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Dialog, Toast } from "antd-mobile";
import { useNavigate } from "react-router-dom";
import { deleteLocation, listInventory, listLocations } from "../api";
import type { InventoryItem, Location } from "../api/types";
import { EmptyState, SectionCard } from "./ui";

export function LocationManagePanel() {
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

  const onDelete = async (loc: Location) => {
    const stock = stockByLocation.get(loc.id) ?? 0;
    if (stock > 0) {
      Toast.show({ icon: "fail", content: `库存 ${stock}，不能删除` });
      return;
    }
    const confirmed = await Dialog.confirm({ content: `删除「${loc.name}」？其子库位也会被删除。` });
    if (!confirmed) return;
    setSaving(true);
    try {
      await deleteLocation(loc.id);
      Toast.show({ icon: "success", content: "已删除" });
      await loadData();
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "删除失败" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="panel-toolbar">
        <Button size="small" color="primary" onClick={() => navigate("/locations/new")}>
          + 新增库位
        </Button>
      </div>

      <SectionCard title={loading ? "加载中…" : `库位 ${locations.length} 个`}>
        {locations.length === 0 && !loading ? (
          <EmptyState icon="location" text="暂无库位" hint="点击上方按钮新增" />
        ) : (
          <div className="location-list">
            {locations.map((loc) => {
              const stock = stockByLocation.get(loc.id) ?? 0;
              return (
                <div className="location-card location-manage-card" key={loc.id}>
                  <div className="location-card-main">
                    <div className="location-name">
                      {loc.parent_id && <span className="loc-tree">├ </span>}
                      {loc.name}
                    </div>
                    <div className="location-meta">
                      <span className="chip">{loc.code}</span>
                      <span className="chip chip-muted">{loc.type}</span>
                    </div>
                  </div>
                  <div className="location-card-actions">
                    <span className="stock-badge">库存 {stock}</span>
                    {(loc.grid_rows || ["货柜", "货架"].includes(loc.type)) && (
                      <Button size="mini" fill="outline" onClick={() => navigate(`/shelves/${loc.id}`)}>
                        格位图
                      </Button>
                    )}
                    <Button size="mini" fill="outline" onClick={() => navigate(`/locations/${loc.id}/edit`)}>
                      编辑
                    </Button>
                    <Button
                      size="mini"
                      color="danger"
                      fill="outline"
                      disabled={stock > 0 || saving}
                      onClick={() => onDelete(loc)}
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
    </>
  );
}
