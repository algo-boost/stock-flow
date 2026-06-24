import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthGate";
import { ROLE_LABEL, RoleBadge } from "./ui";

export function Layout({
  title,
  children,
  hint,
  backTo,
  backState,
  onBack,
}: {
  title: string;
  children: React.ReactNode;
  hint?: string;
  backTo?: string;
  backState?: unknown;
  onBack?: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, canApprove, loading, authStep, pendingCount } = useAuth();

  const canManage = user && (user.role === "KEEPER" || user.role === "ADMIN");

  const tabs = [
    { key: "/", title: "首页", icon: "home" },
    { key: "/history", title: "历史", icon: "history", badge: canApprove && pendingCount > 0 ? pendingCount : undefined },
    ...(canManage
      ? [{ key: "/manage", title: "管理", icon: "tune", badge: canApprove ? pendingCount : undefined }]
      : []),
  ];

  const rootPaths = ["/", "/history", "/manage"];
  const showBack = location.pathname !== "/" && !rootPaths.includes(location.pathname);

  return (
    <div className="page">
      <div className={`top-loader ${loading ? "active" : ""}`} />
      <header className="page-navbar">
        <div className="page-navbar-main">
          {showBack ? (
            <button
              type="button"
              className="nav-back"
              aria-label="返回"
              onClick={() => {
                if (onBack) {
                  onBack();
                } else if (backTo) {
                  navigate(backTo, backState ? { state: backState } : undefined);
                } else {
                  navigate(-1);
                }
              }}
            >
              <span aria-hidden>‹</span>
            </button>
          ) : (
            <button type="button" className="app-brand" onClick={() => navigate("/")} aria-label="返回首页">
              <img src="/logo.png" alt="物料管理" className="app-logo" />
            </button>
          )}
          {showBack && (
            <div className="page-title-block">
              <h1 className="page-title">{title}</h1>
            </div>
          )}
        </div>
        <div className="page-navbar-right">
          {loading && <span className="nav-loading-hint">{hint || authStep || "加载中…"}</span>}
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
              t.key === "/manage"
                ? location.pathname === "/manage" ||
                  location.pathname.startsWith("/locations/") ||
                  location.pathname === "/locations"
                : t.key === "/"
                  ? location.pathname === "/" || location.pathname.startsWith("/shelves/")
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
