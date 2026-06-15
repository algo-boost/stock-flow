import { useState } from "react";
import { Button, Toast } from "antd-mobile";
import { refreshBitableCache } from "../api";

export function CacheRefreshButton({ onRefreshed }: { onRefreshed?: () => Promise<void> | void }) {
  const [refreshing, setRefreshing] = useState(false);

  const onClick = async () => {
    setRefreshing(true);
    try {
      const result = await refreshBitableCache();
      await onRefreshed?.();
      const failedCount = Object.keys(result.failed ?? {}).length;
      Toast.show({
        icon: failedCount > 0 ? "fail" : "success",
        content:
          failedCount > 0
            ? `${result.message}（${failedCount} 张表失败）`
            : result.message || "缓存已刷新",
      });
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "刷新缓存失败" });
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Button size="small" fill="outline" loading={refreshing} onClick={onClick}>
      刷新缓存
    </Button>
  );
}
