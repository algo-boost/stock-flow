import { useCallback, useEffect, useState } from "react";
import { Button, Dialog, Toast } from "antd-mobile";
import { getAdminSystem, getSqliteCacheStatus, pushToFeishu, pullFromFeishu } from "../api";
import { useAuth } from "./AuthGate";
import { FeishuIcon } from "./FeishuIcon";
import { SectionCard } from "./ui";

type LabeledTable = { id: string; label: string; count: number };

function fmtInterval(seconds: number | undefined): string {
  if (!seconds || seconds <= 0) return "已关闭";
  if (seconds >= 3600) return `每 ${Math.round(seconds / 3600)} 小时`;
  if (seconds >= 60) return `每 ${Math.round(seconds / 60)} 分钟`;
  return `每 ${seconds} 秒`;
}

export function AdminSystemPanel({ onRefreshed }: { onRefreshed?: () => Promise<void> | void }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [system, setSystem] = useState<{ bitable_mode?: string } | null>(null);
  const [sqlite, setSqlite] = useState<{
    enabled: boolean;
    labeled_tables?: LabeledTable[];
    sync_interval?: number;
  } | null>(null);
  const [busyPush, setBusyPush] = useState(false);
  const [busyPull, setBusyPull] = useState(false);

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

  const onPushToFeishu = async () => {
    const confirmed = await Dialog.confirm({
      content: "将本地数据推送到飞书多维表格，覆盖飞书端对应记录。\n\n确定要继续吗？",
    });
    if (!confirmed) return;
    setBusyPush(true);
    try {
      const result = await pushToFeishu();
      Toast.show({ icon: "success", content: result.message || "推送完成" });
      void load();
      void onRefreshed?.();
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "推送失败" });
    } finally {
      setBusyPush(false);
    }
  };

  const onPullFromFeishu = async () => {
    const confirmed = await Dialog.confirm({
      content: "从飞书多维表格拉取最新数据到本地缓存。\n\n确定要继续吗？",
    });
    if (!confirmed) return;
    setBusyPull(true);
    try {
      const result = await pullFromFeishu();
      Toast.show({ icon: "success", content: result.message || "同步完成" });
      void load();
      void onRefreshed?.();
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "同步失败" });
    } finally {
      setBusyPull(false);
    }
  };

  if (!isAdmin && !user) return null;

  const tables = sqlite?.labeled_tables ?? [];
  const isRealMode = system?.bitable_mode === "real";

  // 非管理员用户：仅显示提示
  if (!isAdmin) {
    return (
      <SectionCard title="数据同步" subtitle="同步功能仅限管理员操作">
        <p className="admin-system-hint">如需同步数据，请联系管理员。</p>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title={isAdmin ? "系统" : "数据同步"}
      subtitle={isAdmin ? "数据源与本地缓存状态（管理员）" : "若在飞书表格直接改数据，可点此同步"}
    >
      {isAdmin && (
        <div className="admin-system-meta">
          {system?.bitable_mode && <span>数据源：{isRealMode ? "飞书多维表格" : system.bitable_mode}</span>}
          {sqlite && <span>本地缓存：{sqlite.enabled ? "已启用" : "未启用"}</span>}
          {sqlite?.sync_interval !== undefined && <span>自动同步：{fmtInterval(sqlite.sync_interval)}</span>}
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
      {isAdmin && isRealMode && (
        <>
          <p className="admin-system-hint">
            本地 → 飞书：将本地新增/修改的记录推送到飞书多维表格。
            <br />
            飞书 → 本地：从飞书多维表格拉取最新数据覆盖本地缓存。
          </p>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <Button
              size="small"
              fill="outline"
              loading={busyPush}
              onClick={() => void onPushToFeishu()}
              className="cache-refresh-btn"
            >
              <FeishuIcon name="upload" size={16} />
              <span>本地同步到飞书</span>
            </Button>
            <Button
              size="small"
              fill="outline"
              loading={busyPull}
              onClick={() => void onPullFromFeishu()}
              className="cache-refresh-btn"
            >
              <FeishuIcon name="download" size={16} />
              <span>飞书同步到本地</span>
            </Button>
          </div>
        </>
      )}
    </SectionCard>
  );
}
