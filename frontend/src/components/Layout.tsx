import { NavBar, TabBar } from "antd-mobile";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthGate";
import { RoleBadge } from "./ui";

export function Layout({ title, children }: { title: string; children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, canApprove } = useAuth();

  const tabs = [
    { key: "/", title: "搜索", icon: "🔍" },
    { key: "/outbound", title: user?.role === "USER" ? "申请" : "出库", icon: "📤" },
    { key: "/history", title: "历史", icon: "📒" },
    ...(user && (user.role === "KEEPER" || user.role === "ADMIN")
      ? [
          { key: "/inbound", title: "入库", icon: "📥" },
          { key: "/transfer", title: "移动", icon: "↔" },
          { key: "/locations", title: "库位", icon: "📍" },
        ]
      : []),
    ...(canApprove ? [{ key: "/approvals", title: "审批", icon: "✅" }] : []),
    ...(canApprove ? [{ key: "/purchase", title: "进货", icon: "🛒" }] : []),
    ...(canApprove ? [{ key: "/admin-center", title: "运营", icon: "⚙" }] : []),
  ];

  const showBack =
    location.pathname !== "/" &&
    ![
      "/outbound",
      "/inbound",
      "/transfer",
      "/locations",
      "/history",
      "/approvals",
      "/purchase",
      "/admin-center",
    ].includes(location.pathname);

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
