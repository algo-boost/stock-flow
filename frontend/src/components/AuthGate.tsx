import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Toast } from "antd-mobile";
import { getMe } from "../api";
import type { User, RoleMeta } from "../api/types";
import {
  consumePostLoginRedirect,
  feishuLogin,
  isFeishuClient,
  currentFeishuPageUrl,
  redirectToLoginHomeIfNeeded,
} from "../auth/feishu";
import { apiConfig } from "../api/config";
import { clearAuthToken, getAuthToken } from "../auth/token";
import { EmptyState } from "./ui";

interface AuthContextValue {
  user: User | null;
  roleMeta: RoleMeta | null;
  loading: boolean;
  authStep: string;
  error: string | null;
  canInbound: boolean;
  canApprove: boolean;
  isFeishu: boolean;
  refresh: () => Promise<void>;
  pendingCount: number;
  setPendingCount: (n: number) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const ROLE_RANK: Record<User["role"], number> = {
  USER: 10,
  KEEPER: 20,
  ADMIN: 30,
};

function roleAllows(actual: User["role"], required: User["role"]) {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

function isAuthExpiredError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const msg = e.message;
  return msg.includes("登录已过期") || msg.includes("未登录") || msg.includes("401");
}

async function loginWithFeishu(): Promise<{ user: User; roleMeta: RoleMeta | null }> {
  if (!redirectToLoginHomeIfNeeded()) {
    throw new Error("正在跳转登录页…");
  }
  const data = await feishuLogin();
  consumePostLoginRedirect();
  return { user: data.user, roleMeta: data.role_meta ?? null };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [roleMeta, setRoleMeta] = useState<RoleMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authStep, setAuthStep] = useState("");
  const [pendingCount, setPendingCount] = useState(0);
  const isFeishu = isFeishuClient();

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      if (isFeishu && !getAuthToken()) {
        setAuthStep("正在连接飞书…");
        const login = await loginWithFeishu();
        setUser(login.user);
        setRoleMeta(login.roleMeta);
        return;
      }

      try {
        setAuthStep("正在验证身份…");
        const data = await getMe();
        setUser(data.user);
        setRoleMeta(data.role_meta ?? null);
      } catch (e) {
        // 后端重启后内存 session 丢失，localStorage token 仍有效 → 自动重新免登
        if (isFeishu && getAuthToken() && isAuthExpiredError(e)) {
          clearAuthToken();
          setAuthStep("正在重新登录…");
          const login = await loginWithFeishu();
          setUser(login.user);
          setRoleMeta(login.roleMeta);
          return;
        }
        throw e;
      }
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === "object" && e !== null
            ? JSON.stringify(e)
            : "加载用户失败";
      setError(msg);
      setUser(null);
      setRoleMeta(null);
      if (isFeishu) {
        Toast.show({ icon: "fail", content: msg });
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const canInbound = user?.role === "KEEPER" || user?.role === "ADMIN";
  const canApprove = user?.role === "ADMIN";

  return (
    <AuthContext.Provider
      value={{
        user,
        roleMeta,
        loading,
        authStep,
        error,
        canInbound,
        canApprove,
        isFeishu,
        refresh,
        pendingCount,
        setPendingCount,
      }}
    >
      {!loading && roleMeta?.warning && user && (
        <div className="auth-banner role-warning">
          {roleMeta.warning}
          {roleMeta.permission_url && (
            <div style={{ marginTop: 6, fontSize: 12 }}>
              <a href={roleMeta.permission_url} target="_blank" rel="noreferrer">
                前往开放平台开通 IM 权限
              </a>
            </div>
          )}
        </div>
      )}
      {!loading && error && !user && !apiConfig.useMockAuth && (
        <div className="auth-banner">
          登录失败：{error}
          {isFeishu && (
            <>
              <div style={{ marginTop: 4, fontSize: 12 }}>
                当前页 URL（须与安全设置重定向 URL 一致）：{currentFeishuPageUrl()}
              </div>
              <button
                type="button"
                className="auth-retry-btn"
                onClick={() => {
                  clearAuthToken();
                  void refresh();
                }}
              >
                重新登录
              </button>
            </>
          )}
        </div>
      )}
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function AuthGate({
  roles,
  children,
  fallback = null,
}: {
  roles?: Array<User["role"]>;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { user, loading, authStep } = useAuth();
  if (loading) {
    return (
      <div className="page">
        <div className="page-body">
          <EmptyState icon="⏳" text="正在加载…" hint={authStep || "验证登录与权限"} />
        </div>
      </div>
    );
  }
  if (!user) return <>{fallback}</>;
  if (roles && !roles.some((role) => roleAllows(user.role, role))) return <>{fallback}</>;
  return <>{children}</>;
}

export function useLogoutDev() {
  return () => {
    clearAuthToken();
    window.location.reload();
  };
}
