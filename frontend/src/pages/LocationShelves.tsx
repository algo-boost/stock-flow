import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Popup, Toast } from "antd-mobile";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { fetchShelfMetaCached } from "../utils/cachedApi";
import type { InventoryItem, Location, MaterialSearchItem } from "../api/types";
import { useAuth } from "../components/AuthGate";
import { LocationShelfGrid } from "../components/LocationShelfGrid";
import { Layout } from "../components/Layout";
import { EmptyState, SectionCard } from "../components/ui";
import {
  openMaterialDetail,
  readShelfNavState,
  resolveShelfBack,
} from "../utils/detailNavigation";
import { getLocationPath } from "../utils/locationTree";
import { buildShelfCells } from "../utils/shelfGrid";

const SLOT_RESTORE_KEY = "sf_restore_slot";

interface SlotPanel {
  label: string;
  row: number;
  column: number | null;
  items: InventoryItem[];
  previewOnly?: boolean;
}

function findCellByCoords(
  location: Location,
  inventory: InventoryItem[],
  row: number,
  column: number | null,
) {
  const { cells } = buildShelfCells(location, inventory);
  return (
    cells.find((cell) => cell.row === row && (column == null ? cell.column == null : cell.column === column)) ?? null
  );
}

function saveSlotRestore(locationId: string, row: number, column: number | null) {
  try {
    sessionStorage.setItem(SLOT_RESTORE_KEY, JSON.stringify({ locationId, row, column }));
  } catch {
    /* ignore */
  }
}

export default function LocationShelvesPage() {
  const { locationId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const shelfNav = readShelfNavState(location.state, locationId);
  const [searchParams, setSearchParams] = useSearchParams();
  const { canInbound } = useAuth();
  const [locations, setLocations] = useState<Location[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [materialMap, setMaterialMap] = useState<Map<string, MaterialSearchItem>>(new Map());
  const [loading, setLoading] = useState(true);
  const [slotPanel, setSlotPanel] = useState<SlotPanel | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { locations: locs, inventory: inv, materials } = await fetchShelfMetaCached();
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

  const openSlotFromCoords = useCallback(
    (row: number, column: number | null, replaceUrl = false) => {
      if (!activeLocation) return;
      const cell = findCellByCoords(activeLocation, inventory, row, column);
      if (!cell) return;
      setSlotPanel(cell);
      if (replaceUrl) {
        const next = new URLSearchParams(searchParams);
        next.set("row", String(row));
        if (column != null) next.set("column", String(column));
        else next.delete("column");
        setSearchParams(next, { replace: true });
      }
    },
    [activeLocation, inventory, searchParams, setSearchParams],
  );

  useEffect(() => {
    if (!activeLocation || loading) return;

    const rowParam = searchParams.get("row");
    if (rowParam) {
      const row = Number(rowParam);
      const colParam = searchParams.get("column");
      const column = colParam ? Number(colParam) : null;
      if (Number.isFinite(row)) {
        openSlotFromCoords(row, Number.isFinite(column) ? column : null);
        return;
      }
    }

    try {
      const raw = sessionStorage.getItem(SLOT_RESTORE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as { locationId?: string; row?: number; column?: number | null };
      if (data.locationId !== locationId || data.row == null) return;
      sessionStorage.removeItem(SLOT_RESTORE_KEY);
      openSlotFromCoords(data.row, data.column ?? null, true);
    } catch {
      /* ignore */
    }
  }, [activeLocation, loading, locationId, openSlotFromCoords, searchParams]);

  const openInboundAtSlot = () => {
    if (!slotPanel || !locationId) return;
    const params = new URLSearchParams({ tab: "inbound", location_id: locationId });
    if (slotPanel.row > 0) params.set("row", String(slotPanel.row));
    if (slotPanel.column != null) params.set("column", String(slotPanel.column));
    setSlotPanel(null);
    navigate(`/stock?${params.toString()}`);
  };

  const closeSlotPanel = () => {
    setSlotPanel(null);
    const next = new URLSearchParams(searchParams);
    next.delete("row");
    next.delete("column");
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  };

  if (loading && locations.length === 0) {
    return (
      <Layout title="货架格位">
        <EmptyState loading text="加载中…" />
      </Layout>
    );
  }

  if (!activeLocation) {
    return (
      <Layout title="货架格位">
        <EmptyState icon="location" text="库位不存在" hint="请从首页库位分类进入" />
      </Layout>
    );
  }

  const path = getLocationPath(locations, locationId!);
  const breadcrumbSlot = slotPanel && slotPanel.row > 0 ? slotPanel.label : null;

  const handleBack = () => {
    resolveShelfBack(navigate, shelfNav, () => navigate("/", { state: { browseBy: "location" } }));
  };

  return (
    <Layout title={activeLocation.name} onBack={handleBack}>
      <SectionCard className="flush-body home-section-card">
        <nav className="folder-breadcrumb" aria-label="库位路径">
          <button
            type="button"
            className="folder-crumb"
            onClick={() => navigate("/", { state: { browseBy: "location" } })}
          >
            首页
          </button>
          {path.slice(0, -1).map((node) => (
            <span key={node.id} className="folder-crumb-wrap">
              <span className="folder-crumb-sep">›</span>
              <button
                type="button"
                className="folder-crumb"
                onClick={() => navigate("/", { state: { browseBy: "location", shelfFolderId: node.id } })}
              >
                {node.name}
              </button>
            </span>
          ))}
          <span className="folder-crumb-wrap">
            <span className="folder-crumb-sep">›</span>
            <span className="folder-crumb folder-crumb-active">{activeLocation.name}</span>
          </span>
          {breadcrumbSlot && (
            <span className="folder-crumb-wrap">
              <span className="folder-crumb-sep">›</span>
              <span className="folder-crumb folder-crumb-active">{breadcrumbSlot}</span>
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
          onCellClick={(cell) => {
            setSlotPanel(cell);
            const next = new URLSearchParams(searchParams);
            if (cell.row > 0) next.set("row", String(cell.row));
            if (cell.column != null) next.set("column", String(cell.column));
            setSearchParams(next, { replace: true });
          }}
        />
      </SectionCard>

      <Popup
        visible={slotPanel !== null}
        onMaskClick={closeSlotPanel}
        bodyStyle={{ borderTopLeftRadius: 12, borderTopRightRadius: 12, maxHeight: "70vh", overflow: "auto" }}
      >
        {slotPanel && (
          <div className="popup-panel">
            <div className="popup-panel-head">
              <strong>{slotPanel.label}</strong>
              <button type="button" className="popup-close" onClick={closeSlotPanel}>
                关闭
              </button>
            </div>
            {slotPanel.items.length === 0 ? (
              <>
                <EmptyState icon="package" text="此格为空" hint={canInbound ? "可在此格入库上架" : "请联系库管入库"} />
                {canInbound && (
                  <div className="popup-panel-actions">
                    <Button color="primary" block onClick={openInboundAtSlot}>
                      在此格入库
                    </Button>
                  </div>
                )}
              </>
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
                        if (locationId) {
                          saveSlotRestore(locationId, slotPanel.row, slotPanel.column);
                        }
                        const params = new URLSearchParams(searchParams);
                        if (slotPanel.row > 0) params.set("row", String(slotPanel.row));
                        if (slotPanel.column != null) params.set("column", String(slotPanel.column));
                        const qs = params.toString();
                        openMaterialDetail(navigate, item.material_id, {
                          backTo: `/shelves/${locationId}${qs ? `?${qs}` : ""}`,
                          backState: shelfNav.backTo
                            ? { backTo: shelfNav.backTo, backState: shelfNav.backState }
                            : undefined,
                          fromLabel: `${activeLocation.name} · ${slotPanel.label}`,
                        });
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
