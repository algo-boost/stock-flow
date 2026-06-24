import { Tabs } from "antd-mobile";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../components/AuthGate";
import { Layout } from "../components/Layout";
import { LocationTransferPanel } from "../components/LocationTransferPanel";
import { StockInboundPanel } from "../components/StockInboundPanel";
import { StockOutboundPanel } from "../components/StockOutboundPanel";
import { PageHeader } from "../components/ui";

export default function StockPage() {
  const { canInbound } = useAuth();
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
      <PageHeader title={canInbound ? "出入库" : "申请"} subtitle="完成后返回首页继续操作" />

      <Tabs activeKey={activeTab} onChange={onTabChange} className="compact-tabs">
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
