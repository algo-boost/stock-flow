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
      <header className="page-navbar">
        <div className="page-navbar-main">
          {showBack ? (
            <button type="button" className="nav-back" aria-label="返回" onClick={() => navigate(-1)}>
              <span aria-hidden>‹</span>
            </button>
          ) : (
            <div className="lab-mark" aria-hidden>
              SF
            </div>
          )}
          <div className="page-title-block">
            <div className="page-title-kicker">ROBOTICS LAB</div>
            <h1 className="page-title">{title}</h1>
          </div>
        </div>
        <div className="page-navbar-right">
          {user && <span className="user-pill">{user.name}</span>}
          {user ? <RoleBadge role={user.role} /> : undefined}
        </div>
      </header>
      <div className="page-body">{children}</div>
      {!location.pathname.startsWith("/materials/") && (
        <nav className="page-tabbar" aria-label="主导航">
          {tabs.map((t) => {
            const active = location.pathname === t.key;
            return (
              <button
                key={t.key}
                type="button"
                className={`page-tabbar-item ${active ? "page-tabbar-item-active" : ""}`}
                onClick={() => navigate(t.key)}
              >
                <span className="page-tabbar-icon" aria-hidden>
                  {t.icon}
                </span>
                <span className="page-tabbar-label">{t.title}</span>
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}
