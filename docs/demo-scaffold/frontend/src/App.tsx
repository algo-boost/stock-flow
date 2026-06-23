import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import { TabBar } from "antd-mobile";
import SearchPage from "./pages/Search";
import StockPage from "./pages/Stock";
import { healthCheck, getMe } from "./api";
import { setCurrentUser } from "./auth/feishu";

export default function App() {
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState("search");

  useEffect(() => {
    (async () => {
      try {
        const me = await getMe();
        setCurrentUser(me as any);
      } catch { /* mock 模式忽略 */ }
      setReady(true);
    })();
  }, []);

  if (!ready) return <div style={{ padding: 40, textAlign: "center" }}>加载中...</div>;

  return (
    <BrowserRouter>
      <div style={{ paddingBottom: 56 }}>
        <Routes>
          <Route path="/" element={<SearchPage />} />
          <Route path="/stock" element={<StockPage />} />
        </Routes>
      </div>
      <TabBar activeKey={tab} onChange={setTab} style={{ position: "fixed", bottom: 0, width: "100%" }}>
        <TabBar.Item key="search" icon={<span>🔍</span>} title="搜索" />
        <TabBar.Item key="stock" icon={<span>📦</span>} title="库存" />
      </TabBar>
    </BrowserRouter>
  );
}
