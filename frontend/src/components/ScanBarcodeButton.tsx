import { useState } from "react";
import { Toast } from "antd-mobile";
import { isFeishuClient } from "../auth/feishu";
import { FeishuIcon } from "./FeishuIcon";
import { scanBarcode } from "../utils/feishuScan";

/** 飞书内扫码按钮；非飞书环境不渲染 */
export function ScanBarcodeButton({
  onScan,
  disabled,
  label = "扫码",
}: {
  onScan: (code: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);

  if (!isFeishuClient()) return null;

  const handleScan = async () => {
    setBusy(true);
    try {
      const code = await scanBarcode();
      onScan(code);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "扫码失败";
      if (!msg.includes("取消")) {
        Toast.show({ icon: "fail", content: msg });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className="search-scan-btn"
      aria-label={label}
      disabled={disabled || busy}
      onClick={() => void handleScan()}
    >
      <FeishuIcon name={busy ? "loading" : "scan"} size={20} />
    </button>
  );
}
