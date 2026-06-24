import type { ReactNode } from "react";
import { useState } from "react";
import { ActionSheet, Dialog } from "antd-mobile";
import type { Action } from "antd-mobile/es/components/action-sheet";
import type { Role } from "../api/types";
import { ACTION_ICONS, actionAriaLabel } from "../utils/materialActions";
import { FeishuIcon, type FeishuIconName } from "./FeishuIcon";

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
  warning?: "out" | "low";
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

  const primaryLocation = stockSummary
    ? stockSummary.split(/[,，;；\n]/)[0]?.trim() || stockSummary
    : undefined;

  return (
    <>
      <div className={`material-row${warning ? " material-row-warning" : ""}${warning === "out" ? " material-row-out" : ""}`}>
        <button type="button" className="material-row-body" onClick={onClick}>
          <div className="material-row-name">{name}</div>
          <div className="material-row-meta">
            {category && <span className="material-row-cat">{category}</span>}
            {primaryLocation && <span className="material-row-loc">{primaryLocation}</span>}
          </div>
        </button>
        {quantity != null && (
          <span className={`stock-badge stock-badge-sm${warning ? " stock-badge-warning" : ""}${warning === "out" ? " stock-badge-out" : ""}`}>
            {warning === "out" ? "缺货" : quantity}
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
            <FeishuIcon
              name={ACTION_ICONS[String(action.key)] ?? "info"}
              size={18}
            />
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
            <FeishuIcon name="more-horizontal" size={18} />
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

export function EmptyState({
  icon = "inbox",
  text,
  hint,
  actions,
  loading = false,
}: {
  icon?: FeishuIconName;
  text: string;
  hint?: string;
  actions?: Array<{ label: string; onClick: () => void }>;
  loading?: boolean;
}) {
  const iconName = loading ? "loading" : icon;
  return (
    <div className="empty-state">
      <div className="empty-state-icon" aria-hidden>
        <FeishuIcon name={iconName} size={48} />
      </div>
      <div className="empty-state-text">{text}</div>
      {hint && <div className="empty-state-hint">{hint}</div>}
      {actions && actions.length > 0 && (
        <div className="empty-state-actions">
          {actions.map((action) => (
            <button key={action.label} type="button" className="empty-state-action" onClick={action.onClick}>
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function CardSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="skeleton-list" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton-card" />
      ))}
    </div>
  );
}

export function ShelfGridSkeleton() {
  return (
    <div className="skeleton-shelf-grid" aria-hidden>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="skeleton-shelf-card" />
      ))}
    </div>
  );
}
