/** 快捷操作 → Material Symbols 图标 */
export const ACTION_ICONS: Record<string, string> = {
  outbound: "north",
  inbound: "south",
  "req-outbound": "north",
  "req-inbound": "south",
  transfer: "swap_horiz",
  purchase: "add_shopping_cart",
  edit: "edit",
  detail: "info",
};

export function actionAriaLabel(_key: string, text: string): string {
  return text;
}
