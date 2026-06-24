import { Tabs } from "antd-mobile";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../components/AuthGate";
import { Layout } from "../components/Layout";
import { LocationTransferPanel } from "../components/LocationTransferPanel";
import { StockInboundPanel } from "../components/StockInboundPanel";
import { StockOutboundPanel } from "../components/StockOutboundPanel";
import { PurchaseContent } from "./Purchase";
import { PageHero } from "../components/ui";

export default function StockPage() {
  const { canInbound, canApprove } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") ?? "outbound";

  const onTabChange = (key: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", key);
    next.delete("material_id");
    setSearchParams(next, { replace: true });
  };

  return (
    <Layout title="出入库">
      <PageHero
        title="出入库"
        subtitle={
          canInbound
            ? "出库领用、入库上架、库内移动、采购进货"
            : "提交出入库申请，管理员审批通过后变更库存"
        }
      />

      <Tabs activeKey={activeTab} onChange={onTabChange}>
        <Tabs.Tab title={canInbound ? "出库" : "出库申请"} key="outbound">
          <StockOutboundPanel />
        </Tabs.Tab>
        <Tabs.Tab title={canInbound ? "入库" : "入库申请"} key="inbound">
          <StockInboundPanel />
        </Tabs.Tab>
        {canInbound && (
          <Tabs.Tab title="库内移动" key="transfer">
            <LocationTransferPanel />
          </Tabs.Tab>
        )}
        {canApprove && (
          <Tabs.Tab title="进货" key="purchase">
            <PurchaseContent />
          </Tabs.Tab>
        )}
      </Tabs>
    </Layout>
  );
}
