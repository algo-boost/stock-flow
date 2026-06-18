import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthGate";
import { RoleBadge } from "./ui";

export function Layout({ title, children }: { title: string; children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, canApprove } = useAuth();

  const tabs = [
    { key: "/", title: "搜索", icon: "🔍" },
    { key: "/stock", title: "出入库", icon: "↕" },
    ...(user && (user.role === "KEEPER" || user.role === "ADMIN")
      ? [{ key: "/locations", title: "库位", icon: "📍" }]
      : []),
    { key: "/history", title: "历史", icon: "📒" },
    ...(canApprove ? [{ key: "/purchase", title: "进货", icon: "🛒" }] : []),
    ...(canApprove ? [{ key: "/admin-center", title: "运营", icon: "⚙" }] : []),
  ];

  const showBack =
    location.pathname !== "/" &&
    ![
      "/stock",
      "/locations",
      "/history",
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
            <button type="button" className="app-brand" onClick={() => navigate("/")} aria-label="返回首页">
              <img
                src="/logo.png"
                alt="知来具身 FORESEE ROBOTICS · 物料管理系统"
                className="app-logo"
              />
            </button>
          )}
          {showBack && (
            <div className="page-title-block">
              <h1 className="page-title">{title}</h1>
            </div>
          )}
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
