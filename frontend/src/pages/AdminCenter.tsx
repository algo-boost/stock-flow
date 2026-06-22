import { useCallback, useEffect, useState } from "react";
import { Button, Form, Input, Tabs, Toast } from "antd-mobile";
import { useNavigate, useSearchParams } from "react-router-dom";
import { getAdminAudit, getAdminOverview, getAdminSystem } from "../api";
import type { AdminAudit, AdminOverview, AdminSystem } from "../api/types";
import { ApprovalsPanel } from "../components/ApprovalsPanel";
import { AuthGate } from "../components/AuthGate";
import { Layout } from "../components/Layout";
import { EmptyState, InfoRow, PageHero, SectionCard, StatCard, TxBadge } from "../components/ui";

const ORG_PRESETS = [
  { department: "机器人实验室", position: "实验室负责人", owner: "管理员" },
  { department: "研发组", position: "项目成员", owner: "研发用户" },
  { department: "仓储维护", position: "库管员", owner: "库管员" },
];

const CONFIG_PRESETS = [
  { key: "默认审批角色", value: "ADMIN", remark: "USER 申请通过后执行库存变更" },
  { key: "库存数据源", value: "Bitable", remark: "多维表格为唯一数据源" },
  { key: "缓存刷新策略", value: "手动 + TTL", remark: "管理员可查看缓存状态" },
];

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function stringifyMeta(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function AdminCenterContent() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") ?? "approvals";
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [audit, setAudit] = useState<AdminAudit | null>(null);
  const [system, setSystem] = useState<AdminSystem | null>(null);
  const [loading, setLoading] = useState(false);
  const [orgRows, setOrgRows] = useState(ORG_PRESETS);
  const [configRows, setConfigRows] = useState(CONFIG_PRESETS);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [overviewData, auditData, systemData] = await Promise.all([
        getAdminOverview(),
        getAdminAudit({ limit: 30 }),
        getAdminSystem(),
      ]);
      setOverview(overviewData);
      setAudit(auditData);
      setSystem(systemData);
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "加载运营数据失败" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveShell = () => {
    Toast.show({
      icon: "success",
      content: "已更新前端预览；真实持久化将在后续配置表落地",
    });
  };

  const onTabChange = (key: string) => {
    const next = new URLSearchParams(searchParams);
    if (key === "approvals") {
      next.delete("tab");
    } else {
      next.set("tab", key);
    }
    setSearchParams(next, { replace: true });
  };

  return (
    <Layout title="运营中心">
      <PageHero title="运营中心" subtitle="审批申请、缺货预警、组织配置与系统审计" />

      <SectionCard title="运营概览" subtitle="基于现有 Bitable、申请和流水数据实时汇总">
        <div className="stat-grid">
          <StatCard label="库存总数" value={overview?.totals.inventory_quantity ?? "-"} unit="件" tone="primary" />
          <StatCard label="流水数" value={overview?.totals.transaction_count ?? "-"} unit="笔" />
          <StatCard label="入库数量" value={overview?.totals.inbound_quantity ?? "-"} unit="件" />
          <StatCard label="出库数量" value={overview?.totals.outbound_quantity ?? "-"} unit="件" tone="warning" />
          <StatCard label="待审批" value={overview?.totals.pending_requests ?? "-"} unit="条" tone="warning" />
          <StatCard label="缺货预警" value={overview?.totals.low_stock_count ?? "-"} unit="种" tone="warning" />
          <StatCard label="库存记录" value={overview?.totals.inventory_records ?? "-"} unit="条" />
        </div>
        <div className="admin-center-actions">
          <Button size="small" fill="outline" loading={loading} onClick={() => void load()}>
            刷新数据
          </Button>
        </div>
      </SectionCard>

      {/* ── 可视化数据看板 ── */}
      {overview && (
        <SectionCard title="数据看板" subtitle="库存分布、出入库趋势与物料结构">
          {/* 出入库对比条 */}
          <div className="dash-section">
            <div className="dash-label">出入库对比</div>
            <div className="dash-bar-group">
              <div className="dash-bar-row">
                <span className="dash-bar-tag">入库</span>
                <div className="dash-bar-track">
                  <div
                    className="dash-bar-fill dash-bar-in"
                    style={{
                      width: `${Math.min(100, ((overview.totals.inbound_quantity || 0) / Math.max(1, (overview.totals.inbound_quantity || 0) + (overview.totals.outbound_quantity || 0))) * 100)}%`,
                    }}
                  />
                </div>
                <span className="dash-bar-val">{overview.totals.inbound_quantity ?? 0}件</span>
              </div>
              <div className="dash-bar-row">
                <span className="dash-bar-tag">出库</span>
                <div className="dash-bar-track">
                  <div
                    className="dash-bar-fill dash-bar-out"
                    style={{
                      width: `${Math.min(100, ((overview.totals.outbound_quantity || 0) / Math.max(1, (overview.totals.inbound_quantity || 0) + (overview.totals.outbound_quantity || 0))) * 100)}%`,
                    }}
                  />
                </div>
                <span className="dash-bar-val">{overview.totals.outbound_quantity ?? 0}件</span>
              </div>
            </div>
          </div>

          {/* 审批状态分布 */}
          <div className="dash-section">
            <div className="dash-label">审批状态</div>
            <div className="dash-bar-row">
              <span className="dash-bar-tag">待审批</span>
              <div className="dash-bar-track">
                <div
                  className="dash-bar-fill dash-bar-warn"
                  style={{ width: `${Math.min(100, ((overview.totals.pending_requests || 0) / Math.max(1, overview.totals.pending_requests + overview.totals.approved_requests + overview.totals.rejected_requests)) * 100)}%` }}
                />
              </div>
              <span className="dash-bar-val">{overview.totals.pending_requests ?? 0}</span>
            </div>
            <div className="dash-bar-row">
              <span className="dash-bar-tag">已通过</span>
              <div className="dash-bar-track">
                <div
                  className="dash-bar-fill dash-bar-ok"
                  style={{ width: `${Math.min(100, ((overview.totals.approved_requests || 0) / Math.max(1, overview.totals.pending_requests + overview.totals.approved_requests + overview.totals.rejected_requests)) * 100)}%` }}
                />
              </div>
              <span className="dash-bar-val">{overview.totals.approved_requests ?? 0}</span>
            </div>
            <div className="dash-bar-row">
              <span className="dash-bar-tag">已拒绝</span>
              <div className="dash-bar-track">
                <div
                  className="dash-bar-fill dash-bar-err"
                  style={{ width: `${Math.min(100, ((overview.totals.rejected_requests || 0) / Math.max(1, overview.totals.pending_requests + overview.totals.approved_requests + overview.totals.rejected_requests)) * 100)}%` }}
                />
              </div>
              <span className="dash-bar-val">{overview.totals.rejected_requests ?? 0}</span>
            </div>
          </div>

          {/* 最近流水概览 */}
          {overview.recent_transactions?.length > 0 && (
            <div className="dash-section">
              <div className="dash-label">最近操作</div>
              <div className="tx-list">
                {overview.recent_transactions.slice(0, 5).map((tx) => (
                  <div className="tx-item" key={tx.id}>
                    <TxBadge type={tx.type} />
                    <div className="tx-main">
                      <div className="tx-title">{tx.material_name ?? tx.material_id}</div>
                      <div className="tx-meta">{tx.operator} · {tx.location_name ?? "-"}</div>
                    </div>
                    <div className={`tx-qty ${tx.quantity > 0 ? "tx-qty-in" : "tx-qty-out"}`}>
                      {tx.quantity > 0 ? `+${tx.quantity}` : tx.quantity}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </SectionCard>
      )}

      <SectionCard title="缺货预警" subtitle="总库存低于安全库存的物料，默认安全库存为 5">
        {overview?.low_stock_items?.length ? (
          <div className="tx-list">
            {overview.low_stock_items.map((item) => (
              <button
                key={item.id}
                type="button"
                className="catalog-row"
                onClick={() => navigate(`/purchase?material_id=${item.id}`)}
              >
                <div className="catalog-row-main">
                  <div className="catalog-row-name">{item.name}</div>
                  <div className="catalog-row-meta">
                    <span className="chip">{item.code}</span>
                    {item.supplier && <span className="chip chip-muted">{item.supplier}</span>}
                    <span className="chip chip-muted">安全库存 {item.threshold}</span>
                  </div>
                  <div className="catalog-row-locs">{item.locations_summary ?? "暂无库存"}</div>
                </div>
                <div className="catalog-row-right">
                  <span className="stock-badge stock-badge-warning">库存 {item.total_quantity}</span>
                  <span className="material-card-arrow">›</span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState icon="✅" text="暂无缺货预警" hint="所有物料库存均不低于安全库存" />
        )}
      </SectionCard>

      <Tabs activeKey={activeTab} onChange={onTabChange}>
        <Tabs.Tab title="审批" key="approvals">
          <ApprovalsPanel onReviewed={() => void load()} />
        </Tabs.Tab>

        <Tabs.Tab title="组织" key="org">
          <SectionCard title="用户与组织管理" subtitle="一阶段展示/编辑壳层；真实人员仍以飞书通讯录与角色群组为准">
            <div className="editable-table">
              {orgRows.map((row, index) => (
                <div className="editable-row" key={`${row.department}-${index}`}>
                  <Input
                    value={row.department}
                    placeholder="部门"
                    onChange={(value) =>
                      setOrgRows((rows) =>
                        rows.map((item, i) => (i === index ? { ...item, department: value } : item)),
                      )
                    }
                  />
                  <Input
                    value={row.position}
                    placeholder="岗位"
                    onChange={(value) =>
                      setOrgRows((rows) =>
                        rows.map((item, i) => (i === index ? { ...item, position: value } : item)),
                      )
                    }
                  />
                  <Input
                    value={row.owner}
                    placeholder="默认角色"
                    onChange={(value) =>
                      setOrgRows((rows) =>
                        rows.map((item, i) => (i === index ? { ...item, owner: value } : item)),
                      )
                    }
                  />
                </div>
              ))}
            </div>
            <Button block color="primary" onClick={saveShell}>
              保存组织预览
            </Button>
          </SectionCard>
        </Tabs.Tab>

        <Tabs.Tab title="配置" key="config">
          <SectionCard title="数据字典与系统配置" subtitle="常用固定数据与系统配置项入口">
            <Form layout="horizontal" className="admin-center-form">
              {configRows.map((row, index) => (
                <Form.Item label={row.key} key={row.key}>
                  <Input
                    value={row.value}
                    placeholder={row.remark}
                    onChange={(value) =>
                      setConfigRows((rows) =>
                        rows.map((item, i) => (i === index ? { ...item, value } : item)),
                      )
                    }
                  />
                </Form.Item>
              ))}
            </Form>
            <Button block color="primary" onClick={saveShell}>
              保存配置预览
            </Button>
          </SectionCard>
        </Tabs.Tab>

        <Tabs.Tab title="审计" key="audit">
          <SectionCard title="审计与监控" subtitle="最近操作流水、申请记录和角色判定状态">
            {audit?.recent_transactions.length ? (
              <div className="tx-list">
                {audit.recent_transactions.slice(0, 10).map((tx) => (
                  <div className="tx-item" key={tx.id}>
                    <TxBadge type={tx.type} />
                    <div className="tx-main">
                      <div className="tx-title">{tx.material_name ?? tx.material_id}</div>
                      <div className="tx-meta">
                        {tx.operator} · {tx.location_name ?? tx.location_id} · {formatDate(tx.created_at)}
                      </div>
                    </div>
                    <div className="tx-qty">{tx.quantity > 0 ? `+${tx.quantity}` : tx.quantity}</div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon="📋" text="暂无审计流水" hint="出入库操作后会显示在这里" />
            )}
          </SectionCard>

          <SectionCard title="角色检查状态">
            <InfoRow label="状态" value={stringifyMeta(audit?.role_check?.ok)} />
            <InfoRow label="来源" value={stringifyMeta(audit?.role_check?.source)} />
            <InfoRow label="方式" value={stringifyMeta(audit?.role_check?.method)} />
            <InfoRow label="提示" value={stringifyMeta(audit?.role_check?.warning)} />
          </SectionCard>
        </Tabs.Tab>

        <Tabs.Tab title="系统" key="system">
          <SectionCard title="运行状态与服务器环境">
            <InfoRow label="环境" value={system?.app_env ?? "-"} />
            <InfoRow label="Bitable 模式" value={system?.bitable_mode ?? "-"} />
            <InfoRow label="Bitable 已配置" value={system?.bitable_configured ? "是" : "否"} />
            <InfoRow label="飞书已配置" value={system?.feishu_configured ? "是" : "否"} />
            <InfoRow label="Mock 鉴权" value={system?.mock_auth_enabled ? "开启" : "关闭"} />
            <InfoRow label="缓存 TTL" value={`${system?.bitable_cache_ttl_seconds ?? "-"} 秒`} />
            <InfoRow label="服务时间" value={formatDate(system?.server_time)} />
          </SectionCard>

          <SectionCard title="数据表快照">
            {Object.entries(system?.tables ?? {}).map(([key, value]) => (
              <InfoRow key={key} label={key} value={value} />
            ))}
          </SectionCard>
        </Tabs.Tab>
      </Tabs>
    </Layout>
  );
}

export default function AdminCenterPage() {
  return (
    <AuthGate
      roles={["ADMIN"]}
      fallback={
        <Layout title="运营中心">
          <EmptyState icon="🔒" text="权限不足" hint="仅管理员可访问运营中心" />
        </Layout>
      }
    >
      <AdminCenterContent />
    </AuthGate>
  );
}
