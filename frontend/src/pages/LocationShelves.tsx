import { useCallback, useEffect, useMemo, useState } from "react";
import { Popup, Toast } from "antd-mobile";
import { useNavigate, useParams } from "react-router-dom";
import { listInventory, listLocations, searchMaterials } from "../api";
import type { InventoryItem, Location, MaterialSearchItem } from "../api/types";
import { LocationShelfGrid } from "../components/LocationShelfGrid";
import { Layout } from "../components/Layout";
import { EmptyState, SectionCard } from "../components/ui";
import { formatLocationPath } from "../utils/shelfGrid";

interface SlotPanel {
  label: string;
  row: number;
  column: number | null;
  items: InventoryItem[];
}

export default function LocationShelvesPage() {
  const { locationId } = useParams();
  const navigate = useNavigate();
  const [locations, setLocations] = useState<Location[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [materialMap, setMaterialMap] = useState<Map<string, MaterialSearchItem>>(new Map());
  const [loading, setLoading] = useState(true);
  const [slotPanel, setSlotPanel] = useState<SlotPanel | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [locs, inv, materials] = await Promise.all([
        listLocations(),
        listInventory(),
        searchMaterials("", { page: 1, size: 100 }),
      ]);
      setLocations(locs);
      setInventory(inv);
      setMaterialMap(new Map(materials.items.map((item) => [item.id, item])));
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "加载失败" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!loading && !locationId) {
      navigate("/", { replace: true, state: { browseBy: "location" } });
    }
  }, [loading, locationId, navigate]);

  const activeLocation = useMemo(
    () => (locationId ? locations.find((item) => item.id === locationId) ?? null : null),
    [locationId, locations],
  );

  if (loading && locations.length === 0) {
    return (
      <Layout title="货架格位">
        <EmptyState icon="⏳" text="加载中…" />
      </Layout>
    );
  }

  if (!activeLocation) {
    return (
      <Layout title="货架格位">
        <EmptyState icon="📍" text="库位不存在" hint="请从首页按货架进入" />
      </Layout>
    );
  }

  const path = formatLocationPath(locations, locationId!);

  return (
    <Layout title={activeLocation.name}>
      <SectionCard className="flush-body">
        <nav className="folder-breadcrumb" aria-label="库位路径">
          <button
            type="button"
            className="folder-crumb"
            onClick={() => navigate("/", { state: { browseBy: "location" } })}
          >
            全部
          </button>
          {path && (
            <span className="folder-crumb-wrap">
              <span className="folder-crumb-sep">/</span>
              <span className="folder-crumb folder-crumb-active">{activeLocation.name}</span>
            </span>
          )}
        </nav>
        {!activeLocation.grid_rows && (
          <p className="shelf-config-hint">
            未配置层列数，
            <button type="button" className="dash-action-link" onClick={() => navigate(`/locations/${activeLocation.id}/edit`)}>
              去设置
            </button>
          </p>
        )}
        <LocationShelfGrid
          location={activeLocation}
          inventory={inventory}
          materialNames={new Map([...materialMap.entries()].map(([id, m]) => [id, m.name]))}
          onCellClick={(cell) => setSlotPanel(cell)}
        />
      </SectionCard>

      <Popup
        visible={slotPanel !== null}
        onMaskClick={() => setSlotPanel(null)}
        bodyStyle={{ borderTopLeftRadius: 12, borderTopRightRadius: 12, maxHeight: "70vh", overflow: "auto" }}
      >
        {slotPanel && (
          <div className="popup-panel">
            <div className="popup-panel-head">
              <strong>{slotPanel.label}</strong>
              <button type="button" className="popup-close" onClick={() => setSlotPanel(null)}>
                关闭
              </button>
            </div>
            {slotPanel.items.length === 0 ? (
              <EmptyState icon="📦" text="此格为空" hint="可在入库时指定格位" />
            ) : (
              <div className="tx-list">
                {slotPanel.items.map((item) => {
                  const material = materialMap.get(item.material_id);
                  return (
                    <button
                      key={`${item.material_id}-${item.row}-${item.column}`}
                      type="button"
                      className="catalog-row"
                      onClick={() => {
                        setSlotPanel(null);
                        navigate(`/materials/${item.material_id}`);
                      }}
                    >
                      <div className="catalog-row-main">
                        <div className="catalog-row-name">{material?.name ?? item.material_id}</div>
                        <div className="catalog-row-meta">
                          {material?.code && <span className="chip">{material.code}</span>}
                        </div>
                      </div>
                      <span className="stock-badge">{item.quantity}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </Popup>
    </Layout>
  );
}
