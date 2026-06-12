const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";
export const MOCK_ROLE = (import.meta.env.VITE_MOCK_ROLE as string) ?? "USER";
/** 浏览器非飞书环境时使用 mock 头；飞书内自动免登 */
export const USE_MOCK_AUTH =
  (import.meta.env.VITE_USE_MOCK_AUTH as string | undefined) !== "false";

export const apiConfig = {
  baseUrl: API_BASE,
  mockRole: MOCK_ROLE,
  useMockAuth: USE_MOCK_AUTH,
};
