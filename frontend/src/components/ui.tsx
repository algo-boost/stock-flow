import type { ReactNode } from "react";
import { useState } from "react";
import { ActionSheet, Dialog } from "antd-mobile";
import type { Action } from "antd-mobile/es/components/action-sheet";
import type { Role } from "../api/types";
import { ACTION_ICONS, actionAriaLabel } from "../utils/materialActions";

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "管理员",
  KEEPER: "库管",
  USER: "研发",
};

const ROLE_CLASS: Record<Role, string> = {
  ADMIN: "role-badge role-admin",
  KEEPER: "role-badge role-keeper",
  USER: "role-badge role-user",
};

export function RoleBadge({ role }: { role: Role }) {
  return <span className={ROLE_CLASS[role]}>{ROLE_LABEL[role]}</span>;
}

const PERMISSIONS: Record<Role, { inbound: boolean; transfer: boolean; approve: boolean; label: string }> = {
  USER: { inbound: false, transfer: false, approve: false, label: "研发用户：可搜索、可提交出入库申请" },
  KEEPER: { inbound: true, transfer: true, approve: false, label: "库管员：可搜索、可出库、可入库、可移动" },
  ADMIN: { inbound: true, transfer: true, approve: true, label: "管理员：全部业务功能 + 进货、审批与运营中心" },
};

export function RolePermissions({ role }: { role: Role }) {
  const p = PERMISSIONS[role];
  return (
    <div className="role-permissions">
      <div className="role-permissions-title">{p.label}</div>
      <div className="role-permissions-tags">
        <span className="perm-tag perm-on">{role === "USER" ? "✓ 申请出库" : "✓ 出库"}</span>
        <span className="perm-tag perm-on">✓ 搜索</span>
        <span className={`perm-tag ${p.inbound ? "perm-on" : "perm-off"}`}>
          {p.inbound ? "✓ 入库" : "✓ 申请入库"}
        </span>
        <span className={`perm-tag ${p.transfer ? "perm-on" : "perm-off"}`}>
          {p.transfer ? "✓ 移动" : "✗ 移动"}
        </span>
        {p.approve && <span className="perm-tag perm-on">✓ 审批</span>}
        {role === "ADMIN" && <span className="perm-tag perm-on">✓ 进货</span>}
        {role === "ADMIN" && <span className="perm-tag perm-on">✓ 运营中心</span>}
      </div>
    </div>
  );
}

/** @deprecated 使用 PageHeader */
export function PageHero({
  title,
  subtitle,
  extra,
}: {
  title: string;
  subtitle?: string;
  extra?: ReactNode;
}) {
  return <PageHeader title={title} subtitle={subtitle} extra={extra} />;
}

export function PageHeader({
  title,
  subtitle,
  extra,
}: {
  title: string;
  subtitle?: string;
  extra?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div className="page-header-text">
        <h1 className="page-header-title">{title}</h1>
        {subtitle && <p className="page-header-subtitle">{subtitle}</p>}
      </div>
      {extra}
    </div>
  );
}

export function SectionCard({
  title,
  subtitle,
  children,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}) {
  const flush = className.includes("flush-body");
  return (
    <section className={`section-card ${className}`.trim()}>
      {(title || subtitle) && (
        <header className="section-card-header">
          {title && <h2 className="section-card-title">{title}</h2>}
          {subtitle && <p className="section-card-subtitle">{subtitle}</p>}
        </header>
      )}
      <div className={`section-card-body${flush ? " flush" : ""}`}>{children}</div>
    </section>
  );
}

export function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="info-row">
      <span className="info-row-label">{label}</span>
      <span className="info-row-value">{value}</span>
    </div>
  );
}

export function StatCard({
  label,
  value,
  unit,
  tone = "default",
}: {
  label: string;
  value: string | number;
  unit?: string;
  tone?: "default" | "primary" | "warning";
}) {
  return (
    <div className={`stat-card stat-${tone}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">
        {value}
        {unit && <span className="stat-unit">{unit}</span>}
      </div>
    </div>
  );
}

export function MaterialCard({
  name,
  category,
  stockSummary,
  warning,
  onClick,
  onAction,
  actions = [],
  quantity,
  inlineCount = 2,
}: {
  name: string;
  code?: string;
  category?: string;
  unit?: string;
  spec?: string;
  stockSummary?: string;
  warning?: string;
  quantity?: number;
  onClick?: () => void;
  actions?: Action[];
  onAction?: (action: Action) => void;
  inlineCount?: number;
}) {
  const [menuVisible, setMenuVisible] = useState(false);
  const [confirmAction, setConfirmAction] = useState<Action | null>(null);

  const safeActions = actions.filter((a) => !a.disabled);
  const inlineActions = safeActions.slice(0, inlineCount);
  const menuActions = safeActions.slice(inlineCount);

  const handleAction = (action: Action) => {
    if (action.danger) {
      setConfirmAction(action);
      return;
    }
    onAction?.(action);
  };

  return (
    <>
      <div className="material-row">
        <button type="button" className="material-row-body" onClick={onClick}>
          <div className="material-row-name">{name}</div>
          <div className="material-row-meta">
            {category && <span className="material-row-cat">{category}</span>}
            {stockSummary && <span className="material-row-loc">{stockSummary}</span>}
          </div>
        </button>
        {quantity != null && (
          <span className={`stock-badge stock-badge-sm${warning ? " stock-badge-warning" : ""}`}>
            {quantity}
          </span>
        )}
        {inlineActions.map((action) => (
          <button
            key={action.key}
            type="button"
            className={`material-icon-btn ${action.danger ? "action-danger" : ""}`}
            aria-label={actionAriaLabel(String(action.key), String(action.text))}
            title={String(action.text)}
            onClick={(e) => {
              e.stopPropagation();
              handleAction(action);
            }}
          >
            <span className="material-symbols-outlined" aria-hidden>
              {ACTION_ICONS[String(action.key)] ?? "touch_app"}
            </span>
          </button>
        ))}
        {menuActions.length > 0 && (
          <button
            type="button"
            className="material-icon-btn material-icon-btn-muted"
            aria-label="更多操作"
            onClick={(e) => {
              e.stopPropagation();
              setMenuVisible(true);
            }}
          >
            <span className="material-symbols-outlined" aria-hidden>
              more_horiz
            </span>
          </button>
        )}
      </div>

      {menuActions.length > 0 && (
        <ActionSheet
          visible={menuVisible}
          actions={menuActions}
          onClose={() => setMenuVisible(false)}
          onAction={(action) => {
            setMenuVisible(false);
            handleAction(action);
          }}
          cancelText="取消"
        />
      )}

      {/* 危险操作二次确认 */}
      <Dialog
        visible={confirmAction !== null}
        title={confirmAction?.text}
        content={`确定要${confirmAction?.text}吗？此操作不可撤销。`}
        actions={[
          { key: "cancel", text: "取消", onClick: () => setConfirmAction(null) },
          {
            key: "confirm",
            text: "确认",
            bold: true,
            danger: true,
            onClick: () => {
              if (confirmAction) onAction?.(confirmAction);
              setConfirmAction(null);
            },
          },
        ]}
        onClose={() => setConfirmAction(null)}
      />
    </>
  );
}

export function TxBadge({ type }: { type: string }) {
  const isIn = type.includes("入");
  const isTransfer = type.includes("移") || type.includes("调");
  return <span className={`tx-badge ${isTransfer ? "tx-transfer" : isIn ? "tx-in" : "tx-out"}`}>{type}</span>;
}

export function EmptyState({ icon, text, hint }: { icon: string; text: string; hint?: string }) {
  return (
    <div className="empty-state">
      <div className="empty-state-illustration" aria-hidden>
        <svg viewBox="0 0 120 120" role="img">
          <rect x="34" y="44" width="52" height="38" rx="6" />
          <path d="M60 32v12" />
          <circle cx="60" cy="28" r="5" />
          <circle cx="50" cy="60" r="3" />
          <circle cx="70" cy="60" r="3" />
          <path d="M52 72h16" />
          <path d="M26 56v20" />
          <path d="M94 56v20" />
          <path d="M43 92h12" />
          <path d="M65 92h12" />
        </svg>
      </div>
      <div className="empty-state-icon">{icon}</div>
      <div className="empty-state-text">{text}</div>
      {hint && <div className="empty-state-hint">{hint}</div>}
    </div>
  );
}
