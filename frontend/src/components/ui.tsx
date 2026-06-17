import type { ReactNode } from "react";
import type { Role } from "../api/types";

const ROLE_LABEL: Record<Role, string> = {
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

export function PageHero({
  title,
  subtitle,
  extra,
}: {
  title: string;
  subtitle?: string;
  extra?: ReactNode;
}) {
  return (
    <div className="page-hero">
      <div className="page-hero-text">
        <h1 className="page-hero-title">{title}</h1>
        {subtitle && <p className="page-hero-subtitle">{subtitle}</p>}
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
  return (
    <section className={`section-card ${className}`.trim()}>
      {(title || subtitle) && (
        <header className="section-card-header">
          {title && <h2 className="section-card-title">{title}</h2>}
          {subtitle && <p className="section-card-subtitle">{subtitle}</p>}
        </header>
      )}
      <div className="section-card-body">{children}</div>
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
  code,
  category,
  unit,
  stockSummary,
  warning,
  onClick,
}: {
  name: string;
  code: string;
  category?: string;
  unit?: string;
  stockSummary?: string;
  warning?: string;
  onClick?: () => void;
}) {
  return (
    <button type="button" className="material-card" onClick={onClick}>
      <div className="material-card-icon">📦</div>
      <div className="material-card-main">
        <div className="material-card-name">{name}</div>
        <div className="material-card-meta">
          <span className="chip">{code}</span>
          {category && <span className="chip chip-muted">{category}</span>}
          {unit && <span className="chip chip-muted">{unit}</span>}
        </div>
        {warning && <div className="material-card-warning">{warning}</div>}
        {stockSummary && <div className="material-card-summary">{stockSummary}</div>}
      </div>
      <span className="material-card-arrow">›</span>
    </button>
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
      <div className="empty-state-icon">{icon}</div>
      <div className="empty-state-text">{text}</div>
      {hint && <div className="empty-state-hint">{hint}</div>}
    </div>
  );
}
