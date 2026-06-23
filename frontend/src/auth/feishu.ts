import { apiConfig } from "../api/config";
import { setAuthToken } from "./token";
import type { User, RoleMeta } from "../api/types";

const H5_SDK_URL = "https://lf1-cdn-tos.bytegoofy.com/goofy/lark/op/h5-js-sdk-1.5.23.js";

const LOGIN_SCOPES = ["contact:user.base:readonly", "im:chat:readonly", "im:chat.members:read"];

declare global {
  interface Window {
    h5sdk?: {
      config: (opts: Record<string, unknown>) => void;
      ready: (callback: () => void) => void;
      error?: (callback: (err: unknown) => void) => void;
    };
    tt?: {
      requestAccess?: (opts: {
        appID: string;
        scopeList?: string[];
        success: (res: { code: string }) => void;
        fail: (err: unknown) => void;
      }) => void;
      requestAuthCode?: (opts: {
        appId: string;
        success: (res: { code: string }) => void;
        fail: (err: unknown) => void;
      }) => void;
    };
  }
}

/** 仅 Lark/Feishu 客户端；不含 Electron，避免 Cursor 等误判 */
export function isFeishuClient(): boolean {
  return /Lark|Feishu/i.test(navigator.userAgent) || Boolean(window.h5sdk || window.tt);
}

export function currentFeishuPageUrl(): string {
  return window.location.href.split("#")[0].split("?")[0];
}

/** 免登必须在已配置的重定向 URL 上发起。飞书工作台入口 URL 设为 "/" 可跳过此跳转。 */
export function redirectToLoginHomeIfNeeded(): boolean {
  const { pathname, search, origin } = window.location;
  // 已在首页，直接免登
  if (pathname === "/" || pathname === "") return true;
  // 其他路径：先跳回首屏完成免登，再回到目标页
  // 仅在首次登录时触发一次（有 post_login_redirect 标记说明已回过首页）
  if (sessionStorage.getItem("post_login_redirect")) return true;
  sessionStorage.setItem("post_login_redirect", pathname + search);
  window.location.replace(`${origin}/`);
  return false;
}

export function consumePostLoginRedirect(): void {
  const back = sessionStorage.getItem("post_login_redirect");
  if (!back) return;
  sessionStorage.removeItem("post_login_redirect");
  // 用 replace 而非 href，避免多余的浏览器历史记录
  window.location.replace(window.location.origin + back);
}

function hasLoginApi(): boolean {
  return Boolean(window.tt?.requestAccess || window.tt?.requestAuthCode);
}

function formatFeishuError(err: unknown, fallback: string): Error {
  if (err instanceof Error) return err;
  if (typeof err === "string") return new Error(err);
  if (err && typeof err === "object") {
    const o = err as Record<string, unknown>;
    const parts: string[] = [];
    if (o.errMsg) parts.push(String(o.errMsg));
    if (o.errno != null) parts.push(`errno=${o.errno}`);
    if (o.errCode != null) parts.push(`errCode=${o.errCode}`);
    if (parts.length) {
      const hint = feishuErrnoHint(Number(o.errno ?? o.errCode));
      return new Error(hint ? `${parts.join(" ")}（${hint}）` : parts.join(" "));
    }
    return new Error(`${fallback}: ${JSON.stringify(o)}`);
  }
  return new Error(fallback);
}

function feishuErrnoHint(code: number): string | null {
  const map: Record<number, string> = {
    10200: "App ID 与开放平台不一致",
    10227: "应用可见性检查失败",
    10228: "你不在应用可用范围内，请发布测试版并加入可用范围",
    10235: "未配置重定向 URL",
    10236: "当前页面 URL 不在重定向 URL 列表中",
  };
  return map[code] ?? null;
}

async function fetchApiData<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${apiConfig.baseUrl}${path}`, init);
  const text = await resp.text();
  type Envelope = { code?: number; message?: string; data?: T; detail?: string | unknown };
  let body: Envelope;
  try {
    body = JSON.parse(text) as Envelope;
  } catch {
    throw new Error(
      text.trim().slice(0, 200) ||
        `后端异常 (${resp.status})，请确认 backend:8000 与 frontend:5173 均在运行`,
    );
  }
  if (!resp.ok || body.code !== 0) {
    const detail = typeof body.detail === "string" ? body.detail : undefined;
    throw new Error(body.message || detail || `请求失败 (${resp.status})`);
  }
  return body.data as T;
}

async function fetchAppId(): Promise<string> {
  const pageUrl = currentFeishuPageUrl();
  const data = await fetchApiData<{ appId: string }>(
    `/auth/jsapi-config?url=${encodeURIComponent(pageUrl)}`,
  );
  const appId = String(data.appId || "");
  if (!appId) throw new Error("后端未返回 App ID");
  return appId;
}

function loadH5SdkScript(): Promise<void> {
  if (document.querySelector(`script[src="${H5_SDK_URL}"]`)) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = H5_SDK_URL;
    // async 加载，不阻塞页面渲染（index.html 已有 preconnect 预热连接）
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("飞书 H5 SDK 加载失败"));
    document.head.appendChild(script);
  });
}

function waitForLoginApi(timeoutMs = 3000): Promise<void> {
  if (hasLoginApi()) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      if (hasLoginApi()) {
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        reject(
          new Error(
            "飞书 JSAPI 未就绪。请从飞书工作台打开本应用（勿用系统浏览器或 Cursor 内预览）",
          ),
        );
        return;
      }
      window.setTimeout(tick, 100);
    };
    tick();
  });
}

async function ensureFeishuSdk(): Promise<void> {
  if (!hasLoginApi()) {
    await loadH5SdkScript().catch(() => undefined);
  }
  await waitForLoginApi();
}

function runWhenReady(fn: () => void): void {
  if (window.h5sdk?.ready) {
    window.h5sdk.ready(fn);
  } else {
    fn();
  }
}

function requestLoginCode(appId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    runWhenReady(() => {
      if (window.tt?.requestAccess) {
        window.tt.requestAccess({
          appID: appId,
          scopeList: LOGIN_SCOPES,
          success: (res) => resolve(res.code),
          fail: (err) => reject(formatFeishuError(err, "requestAccess 失败")),
        });
        return;
      }
      if (window.tt?.requestAuthCode) {
        window.tt.requestAuthCode({
          appId,
          success: (res) => resolve(res.code),
          fail: (err) => reject(formatFeishuError(err, "requestAuthCode 失败")),
        });
        return;
      }
      reject(new Error("免登 API 不可用，请在飞书客户端工作台内打开"));
    });
  });
}

export async function feishuLogin(): Promise<{
  token: string;
  user: User;
  role_meta?: RoleMeta | null;
}> {
  console.time("🔐 feishuLogin 总耗时");

  console.time("  └ ensureFeishuSdk");
  await ensureFeishuSdk();
  console.timeEnd("  └ ensureFeishuSdk");

  console.time("  └ fetchAppId");
  const appId = await fetchAppId();
  console.timeEnd("  └ fetchAppId");

  console.time("  └ requestLoginCode");
  const code = await requestLoginCode(appId);
  console.timeEnd("  └ requestLoginCode");

  console.time("  └ POST /auth/feishu/login");
  const data = await fetchApiData<{
    token: string;
    user: User;
    role_meta?: RoleMeta | null;
  }>("/auth/feishu/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  console.timeEnd("  └ POST /auth/feishu/login");

  setAuthToken(data.token);
  console.timeEnd("🔐 feishuLogin 总耗时");
  return data;
}
