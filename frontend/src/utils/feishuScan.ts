import { isFeishuClient, runWhenFeishuReady } from "../auth/feishu";
import { getFeishuJsapiReady } from "./feishuNavigation";

/** 飞书 JSAPI 扫码（条码/二维码），非飞书环境抛错 */
export async function scanBarcode(): Promise<string> {
  if (!isFeishuClient()) {
    throw new Error("请在飞书客户端中使用扫码");
  }
  const ready = await getFeishuJsapiReady();
  if (!ready) {
    throw new Error("飞书 JSAPI 未就绪，请稍后重试");
  }
  return new Promise((resolve, reject) => {
    runWhenFeishuReady(() => {
      const scan = (window.tt as { scanCode?: (opts: Record<string, unknown>) => void } | undefined)?.scanCode;
      if (!scan) {
        reject(new Error("当前飞书版本不支持扫码"));
        return;
      }
      scan({
        scanType: ["barCode", "qrCode"],
        barCodeInput: true,
        success: (res: { result?: string; code?: string }) => {
          const code = String(res.result ?? res.code ?? "").trim();
          if (!code) {
            reject(new Error("未识别到条码"));
            return;
          }
          resolve(code);
        },
        fail: (err: unknown) => {
          reject(err instanceof Error ? err : new Error("扫码取消或失败"));
        },
      });
    });
  });
}
