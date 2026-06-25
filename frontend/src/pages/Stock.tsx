import { useEffect, useState } from "react";
import { Tabs } from "antd-mobile";
import { useLocation, useSearchParams } from "react-router-dom";
import { getMaterial } from "../api";
import { useAuth } from "../components/AuthGate";
import { Layout } from "../components/Layout";
import { LocationTransferPanel } from "../components/LocationTransferPanel";
import { StockInboundPanel } from "../components/StockInboundPanel";
import { StockOutboundPanel } from "../components/StockOutboundPanel";
import { PageHeader } from "../components/ui";
import { readStockNavState } from "../utils/detailNavigation";

type StockTabKey = "outbound" | "inbound" | "transfer";

function resolveInitialMounted(tab: string, canInbound: boolean): Record<StockTabKey, boolean> {
  const key = (tab === "inbound" || tab === "transfer" ? tab : "outbound") as StockTabKey;
  return {
    outbound: key === "outbound",
    inbound: key === "inbound",
    transfer: canInbound && key === "transfer",
  };
}

export default function StockPage() {
  const { canInbound } = useAuth();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get("tab") === "inbound"
    ? "inbound"
    : searchParams.get("tab") === "transfer" && canInbound
      ? "transfer"
      : "outbound") as StockTabKey;
  const materialId = searchParams.get("material_id") ?? "";
  const stockState = readStockNavState(location.state, materialId || undefined);
  const backTo = stockState.materialBackTo;
  const backState = stockState.detailBackState;

  const [materialName, setMaterialName] = useState("");
  const [everMounted, setEverMounted] = useState<Record<StockTabKey, boolean>>(() =>
    resolveInitialMounted(searchParams.get("tab") ?? "outbound", canInbound),
  );

  useEffect(() => {
    if (!materialId) {
      setMaterialName("");
      return;
    }
    void getMaterial(materialId)
      .then((d) => setMaterialName(d.material.name))
      .catch(() => setMaterialName(""));
  }, [materialId]);

  useEffect(() => {
    setEverMounted((prev) => (prev[activeTab] ? prev : { ...prev, [activeTab]: true }));
  }, [activeTab]);

  const onTabChange = (key: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", key);
    if (materialId) next.set("material_id", materialId);
    else next.delete("material_id");
    setSearchParams(next, { replace: true, state: location.state });
  };

  const pageTitle = materialName ? `正在为「${materialName}」办理` : canInbound ? "出入库" : "申请";
  const pageSubtitle = materialName ? "完成后返回物料详情" : "搜到物料后，在详情页底部办理";

  return (
    <Layout title={materialName || "出入库"} backTo={backTo} backState={backState}>
      <PageHeader title={pageTitle} subtitle={pageSubtitle} />

      <Tabs activeKey={activeTab} onChange={onTabChange} className="compact-tabs sticky-page-tabs stock-page-tabs">
        <Tabs.Tab title={canInbound ? "出库" : "申请出库"} key="outbound" />
        <Tabs.Tab title={canInbound ? "入库" : "申请入库"} key="inbound" />
        {canInbound && <Tabs.Tab title="移动" key="transfer" />}
      </Tabs>

      <div className="stock-tab-panels">
        {everMounted.outbound && (
          <div className="stock-tab-pane" hidden={activeTab !== "outbound"}>
            <StockOutboundPanel active={activeTab === "outbound"} />
          </div>
        )}
        {everMounted.inbound && (
          <div className="stock-tab-pane" hidden={activeTab !== "inbound"}>
            <StockInboundPanel active={activeTab === "inbound"} />
          </div>
        )}
        {canInbound && everMounted.transfer && (
          <div className="stock-tab-pane" hidden={activeTab !== "transfer"}>
            <LocationTransferPanel active={activeTab === "transfer"} />
          </div>
        )}
      </div>
    </Layout>
  );
}
