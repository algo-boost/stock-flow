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

export default function StockPage() {
  const { canInbound } = useAuth();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") ?? "outbound";
  const materialId = searchParams.get("material_id") ?? "";
  const stockState = readStockNavState(location.state, materialId || undefined);
  const backTo = materialId ? stockState.materialBackTo : "/";

  const [materialName, setMaterialName] = useState("");

  useEffect(() => {
    if (!materialId) {
      setMaterialName("");
      return;
    }
    void getMaterial(materialId)
      .then((d) => setMaterialName(d.material.name))
      .catch(() => setMaterialName(""));
  }, [materialId]);

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
    <Layout title={materialName || "出入库"} backTo={backTo}>
      <PageHeader title={pageTitle} subtitle={pageSubtitle} />

      <Tabs activeKey={activeTab} onChange={onTabChange} className="compact-tabs sticky-page-tabs">
        <Tabs.Tab title={canInbound ? "出库" : "申请出库"} key="outbound">
          <StockOutboundPanel />
        </Tabs.Tab>
        <Tabs.Tab title={canInbound ? "入库" : "申请入库"} key="inbound">
          <StockInboundPanel />
        </Tabs.Tab>
        {canInbound && (
          <Tabs.Tab title="移动" key="transfer">
            <LocationTransferPanel />
          </Tabs.Tab>
        )}
      </Tabs>
    </Layout>
  );
}
