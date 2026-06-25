import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthGate";
import { FeishuIcon, type FeishuIconName } from "./FeishuIcon";
import { useFeishuPageChrome } from "../utils/feishuNavigation";
import { ROLE_LABEL, RoleBadge } from "./ui";

const TAB_ICONS: Record<string, FeishuIconName> = {
  home: "home",
  history: "history",
  tune: "settings",
};

function isTabActive(tabKey: string, pathname: string): boolean {
  if (tabKey === "/manage") {
    return (
      pathname === "/manage" ||
      pathname.startsWith("/locations/") ||
      pathname === "/locations"
    );
  }
  if (tabKey === "/") {
    return pathname === "/" || pathname.startsWith("/shelves/");
  }
  if (tabKey === "/history") {
    return pathname === "/history" || pathname.startsWith("/history/");
  }
  return pathname === tabKey;
}

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
    { key: "/", title: "首页", icon: "home" as const },
    {
      key: "/history",
      title: "历史",
      icon: "history" as const,
      badge: canApprove && pendingCount > 0 ? pendingCount : undefined,
    },
    ...(canManage
      ? [{ key: "/manage", title: "管理", icon: "tune" as const, badge: canApprove ? pendingCount : undefined }]
      : []),
  ];

  const rootPaths = ["/", "/history", "/manage"];
  const showBack = location.pathname !== "/" && !rootPaths.includes(location.pathname);

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else if (backTo) {
      navigate(backTo, backState ? { state: backState } : undefined);
    } else {
      navigate(-1);
    }
  };

  useFeishuPageChrome({
    title,
    showBack,
    onBack: handleBack,
  });

  const hideTabbar =
    location.pathname.startsWith("/materials/") ||
    location.pathname.startsWith("/stock") ||
    location.pathname === "/purchase";

  const handleTabClick = (tabKey: string) => {
    if (isTabActive(tabKey, location.pathname)) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    navigate(tabKey);
  };

  return (
    <div className={`page${hideTabbar ? " page-no-tabbar" : ""}`}>
      <div className={`top-loader ${loading ? "active" : ""}`} />
      <header className="page-navbar">
        <div className="page-navbar-main">
          {showBack ? (
            <button type="button" className="nav-back" aria-label="返回" onClick={handleBack}>
              <FeishuIcon name="arrow-left" size={22} className="nav-back-icon" />
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
      {!hideTabbar && (
        <nav className="page-tabbar" aria-label="主导航">
          {tabs.map((t) => {
            const active = isTabActive(t.key, location.pathname);
            return (
              <button
                key={t.key}
                type="button"
                className={`page-tabbar-item ${active ? "page-tabbar-item-active" : ""}`}
                onClick={() => handleTabClick(t.key)}
              >
                <FeishuIcon name={TAB_ICONS[t.icon]} size={22} className="page-tabbar-icon" />
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
