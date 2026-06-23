/**
 * 飞书鉴权模块
 * 正式环境：requestAccessCode → 后端换 token
 * mock 模式：跳过，用 X-Mock-Role header
 */

interface User {
  open_id: string;
  name: string;
  role: "ADMIN" | "KEEPER" | "USER";
}

let _currentUser: User | null = null;

export function getCurrentUser(): User | null {
  return _currentUser;
}

export function setCurrentUser(user: User) {
  _currentUser = user;
}

/** 检查是否在飞书客户端中 */
export function isInFeishu(): boolean {
  return typeof (window as any).tt !== "undefined" || typeof (window as any).h5sdk !== "undefined";
}

/** 飞书 H5 免登（正式环境接入时实现） */
export async function feishuLogin(): Promise<User> {
  // TODO: 接入 JSAPI requestAccessCode
  // const code = await (window as any).tt.requestAccessCode();
  // const resp = await fetch("/api/auth/feishu/login", { method: "POST", body: JSON.stringify({ code }) });
  // const data = await resp.json();
  // localStorage.setItem("token", data.data.token);
  // return data.data.user;

  // mock 模式直接返回（由后端 X-Mock-Role 判定）
  return { open_id: "mock", name: "用户", role: "USER" };
}
