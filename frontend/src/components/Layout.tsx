import { NavBar, TabBar } from "antd-mobile";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthGate";
import { RoleBadge } from "./ui";

export function Layout({ title, children }: { title: string; children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const tabs = [
    { key: "/", title: "搜索", icon: "🔍" },
    { key: "/outbound", title: "出库", icon: "📤" },
    ...(user && (user.role === "KEEPER" || user.role === "ADMIN")
      ? [{ key: "/inbound", title: "入库", icon: "📥" }]
      : []),
  ];

  const showBack = location.pathname !== "/" && !["/outbound", "/inbound"].includes(location.pathname);

  return (
    <div className="page">
      <div className="page-navbar">
        <NavBar
          onBack={showBack ? () => navigate(-1) : undefined}
          right={user ? <RoleBadge role={user.role} /> : undefined}
        >
          {title}
        </NavBar>
      </div>
      <div className="page-body">{children}</div>
      {!location.pathname.startsWith("/materials/") && (
        <TabBar
          className="page-tabbar"
          activeKey={location.pathname}
          onChange={(key) => navigate(key)}
        >
          {tabs.map((t) => (
            <TabBar.Item key={t.key} icon={<span aria-hidden>{t.icon}</span>} title={t.title} />
          ))}
        </TabBar>
      )}
    </div>
  );
}
