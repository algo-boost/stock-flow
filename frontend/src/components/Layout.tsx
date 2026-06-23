import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthGate";
import { ROLE_LABEL, RoleBadge } from "./ui";

export function Layout({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, canApprove, loading, authStep, pendingCount } = useAuth();

  const tabs = [
    { key: "/", title: "搜索", icon: "🔍" },
    { key: "/stock", title: "出入库", icon: "↕" },
    ...(user && (user.role === "KEEPER" || user.role === "ADMIN")
      ? [{ key: "/locations", title: "库位", icon: "📍" }]
      : []),
    { key: "/history", title: "历史", icon: "📒" },
    ...(user?.role === "USER" ? [{ key: "/returns", title: "待还", icon: "↩" }] : []),
    ...(canApprove ? [{ key: "/purchase", title: "进货", icon: "🛒" }] : []),
    ...(canApprove ? [{ key: "/admin-center", title: "运营", icon: "⚙", badge: pendingCount }] : []),
  ];

  const showBack =
    location.pathname !== "/" &&
    ![
      "/stock",
      "/locations",
      "/history",
      "/returns",
      "/purchase",
      "/admin-center",
    ].includes(location.pathname);

  return (
    <div className="page">
      {/* 顶部进度条 — 任何加载状态都显示 */}
      <div className={`top-loader ${loading ? "active" : ""}`} />
      {/* 加载提示 — 显示当前在做什么 */}
      {loading && (
        <div className="loading-banner">
          <span className="loading-dot" />
          <span className="loading-dot" />
          <span className="loading-dot" />
          <span>{hint || authStep || "正在加载…"}</span>
        </div>
      )}
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
          {user && user.name !== ROLE_LABEL[user.role] && (
            <span className="user-pill">{user.name}</span>
          )}
          {user ? <RoleBadge role={user.role} /> : undefined}
        </div>
      </header>
      <div className="page-body">{children}</div>
      {!location.pathname.startsWith("/materials/") && (
        <nav className="page-tabbar" aria-label="主导航">
          {tabs.map((t) => {
            const active =
              t.key === "/locations"
                ? location.pathname === "/locations" || location.pathname.startsWith("/locations/")
                : location.pathname === t.key;
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
                <span className="page-tabbar-label">
                  {t.title}
                  {(t as { badge?: number }).badge != null && (t as { badge?: number }).badge! > 0 && (
                    <span className="tab-badge">{(t as { badge?: number }).badge}</span>
                  )}
                </span>
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}
