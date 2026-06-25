/** 快捷操作 → 飞书 UD 图标 */
import type { FeishuIconName } from "../components/FeishuIcon";

export const ACTION_ICONS: Record<string, FeishuIconName> = {
  outbound: "arrow-up",
  inbound: "arrow-down",
  "req-outbound": "arrow-up",
  "req-inbound": "arrow-down",
  transfer: "swap",
  purchase: "cart-add",
  edit: "edit",
  detail: "info",
};

export function actionAriaLabel(_key: string, text: string): string {
  return text;
}
