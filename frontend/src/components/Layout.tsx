import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthGate";
import { ROLE_LABEL, RoleBadge } from "./ui";

export function Layout({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, canApprove, loading, authStep, pendingCount } = useAuth();

  const tabs = [
    { key: "/", title: "搜索", icon: "search" },
    { key: "/stock", title: "出入库", icon: "swap_vert" },
    ...(user && (user.role === "KEEPER" || user.role === "ADMIN")
      ? [{ key: "/locations", title: "库位", icon: "location_on" }]
      : []),
    { key: "/history", title: "历史", icon: "history" },
    ...(user?.role === "USER" ? [{ key: "/returns", title: "待还", icon: "undo" }] : []),
    ...(canApprove ? [{ key: "/admin-center", title: "运营", icon: "admin_panel_settings", badge: pendingCount }] : []),
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
      {/* 顶部进度条 */}
      <div className={`top-loader ${loading ? "active" : ""}`} />
      {/* 冷启动全屏加载 — 给用户心理安慰 */}
      {loading && (
        <div className="cold-start-splash">
          <div className="cold-start-card">
            <div className="cold-start-logo">📦</div>
            <div className="cold-start-title">物料管理系统</div>
            <div className="cold-start-progress">
              <div className="cold-start-bar"><div className="cold-start-bar-fill" /></div>
            </div>
            <div className="cold-start-step">{hint || authStep || "正在启动…"}</div>
            <div className="cold-start-dots">
              <span className="loading-dot" /><span className="loading-dot" /><span className="loading-dot" />
            </div>
          </div>
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
                <span className="page-tabbar-icon material-symbols-outlined" aria-hidden>
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
