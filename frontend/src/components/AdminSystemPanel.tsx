import { useCallback, useEffect, useState } from "react";
import { Button, Toast } from "antd-mobile";
import { getAdminSystem, getSqliteCacheStatus, refreshBitableCache } from "../api";
import { useAuth } from "./AuthGate";
import { FeishuIcon } from "./FeishuIcon";
import { SectionCard } from "./ui";

type LabeledTable = { id: string; label: string; count: number };

export function AdminSystemPanel({ onRefreshed }: { onRefreshed?: () => Promise<void> | void }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [system, setSystem] = useState<{ bitable_mode?: string } | null>(null);
  const [sqlite, setSqlite] = useState<{
    enabled: boolean;
    labeled_tables?: LabeledTable[];
    sync_interval?: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const [sys, status] = await Promise.all([getAdminSystem(), getSqliteCacheStatus()]);
      setSystem(sys);
      setSqlite(status);
    } catch {
      /* SQLite 未启用时静默 */
    }
  }, [isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSync = async () => {
    setBusy(true);
    try {
      const result = await refreshBitableCache();
      Toast.show({
        icon: "success",
        content: result.message || "缓存已刷新",
      });
      void load();
      void onRefreshed?.();
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "同步失败" });
    } finally {
      setBusy(false);
    }
  };

  if (!isAdmin && !user) return null;

  const tables = sqlite?.labeled_tables ?? [];

  return (
    <SectionCard
      title={isAdmin ? "系统" : "数据同步"}
      subtitle={isAdmin ? "数据源与本地缓存状态（管理员）" : "若在飞书表格直接改数据，可点此同步"}
    >
      {isAdmin && (
        <div className="admin-system-meta">
          {system?.bitable_mode && <span>数据源：{system.bitable_mode === "real" ? "飞书多维表格" : system.bitable_mode}</span>}
          {sqlite && <span>本地缓存：{sqlite.enabled ? "已启用" : "未启用"}</span>}
          {sqlite?.sync_interval ? <span>自动同步：每 {sqlite.sync_interval}s</span> : null}
        </div>
      )}
      {isAdmin && tables.length > 0 && (
        <div className="admin-system-table-grid">
          {tables.map((row) => (
            <div className="admin-system-table-row" key={row.id}>
              <span className="admin-system-table-label">{row.label}</span>
              <span className="admin-system-table-count">{row.count} 条</span>
            </div>
          ))}
        </div>
      )}
      {(sqlite?.enabled || !isAdmin) && (
        <p className="admin-system-hint">
          {isAdmin
            ? "点击同步会先从本地缓存快速加载页面，再在后台拉取飞书最新数据（约需数秒，无需等待）。"
            : "同步后各页面会读取最新库存与物料数据。"}
        </p>
      )}
      <Button size="small" fill="outline" loading={busy} onClick={() => void onSync()} className="cache-refresh-btn">
        <FeishuIcon name="refresh" size={16} />
        <span>{isAdmin ? "从飞书同步数据" : "同步最新数据"}</span>
      </Button>
    </SectionCard>
  );
}
