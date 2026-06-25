import { useState } from "react";
import { Button, Toast } from "antd-mobile";
import { invalidateDataCache } from "../utils/dataCache";
import { clearLocalGetCache, notifyDataMutation } from "../utils/dataMutation";
import { refreshBitableCache } from "../api";
import { FeishuIcon } from "./FeishuIcon";

/** 库管/管理员：手动刷新 Bitable 读缓存 */
export function CacheRefreshButton({ onRefreshed }: { onRefreshed?: () => Promise<void> | void }) {
  const [busy, setBusy] = useState(false);

  const handleRefresh = async () => {
    setBusy(true);
    try {
      invalidateDataCache("meta:");
      invalidateDataCache("tx:");
      clearLocalGetCache();
      notifyDataMutation("all");
      const result = await refreshBitableCache();
      const summary = result.message
        || (Object.entries(result.tables ?? {})
          .map(([name, count]) => `${name} ${count}`)
          .join(" · ") || "缓存已刷新");
      Toast.show({
        icon: "success",
        content: summary,
      });
      void onRefreshed?.();
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "刷新失败" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      size="small"
      fill="outline"
      loading={busy}
      onClick={() => void handleRefresh()}
      className="cache-refresh-btn"
    >
      <FeishuIcon name="refresh" size={16} />
      <span>刷新数据缓存</span>
    </Button>
  );
}
