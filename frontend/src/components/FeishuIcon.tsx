import type { SVGProps } from "react";

/** 飞书 Universe Design 风格线性图标（内联 SVG，不依赖外部字体） */
export type FeishuIconName =
  | "home"
  | "history"
  | "settings"
  | "more-vertical"
  | "more-horizontal"
  | "arrow-up"
  | "arrow-down"
  | "arrow-left"
  | "swap"
  | "cart-add"
  | "edit"
  | "info"
  | "loading"
  | "package"
  | "location"
  | "lock"
  | "list"
  | "tag"
  | "check-circle"
  | "inbox"
  | "folder"
  | "folder-open"
  | "warehouse"
  | "search"
  | "scan"
  | "refresh"
  | "plus"
  | "chevron-right"
  | "trash";

type IconDef = (props: { className?: string }) => JSX.Element;

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function Svg({ className, children, spin }: SVGProps<SVGSVGElement> & { spin?: boolean }) {
  return (
    <svg
      className={`feishu-icon${spin ? " feishu-icon-spin" : ""}${className ? ` ${className}` : ""}`}
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      aria-hidden
    >
      {children}
    </svg>
  );
}

const ICONS: Record<FeishuIconName, IconDef> = {
  home: (p) => (
    <Svg {...p}>
      <path {...stroke} d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5H15v-6H9v6H5.5A1.5 1.5 0 0 1 4 19v-8.5Z" />
    </Svg>
  ),
  history: (p) => (
    <Svg {...p}>
      <circle {...stroke} cx="12" cy="12" r="8" />
      <path {...stroke} d="M12 8v4.5l3 2" />
    </Svg>
  ),
  settings: (p) => (
    <Svg {...p}>
      <circle {...stroke} cx="12" cy="12" r="3" />
      <path
        {...stroke}
        d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"
      />
    </Svg>
  ),
  "more-vertical": (p) => (
    <Svg {...p}>
      <circle fill="currentColor" cx="12" cy="6" r="1.25" />
      <circle fill="currentColor" cx="12" cy="12" r="1.25" />
      <circle fill="currentColor" cx="12" cy="18" r="1.25" />
    </Svg>
  ),
  "more-horizontal": (p) => (
    <Svg {...p}>
      <circle fill="currentColor" cx="6" cy="12" r="1.25" />
      <circle fill="currentColor" cx="12" cy="12" r="1.25" />
      <circle fill="currentColor" cx="18" cy="12" r="1.25" />
    </Svg>
  ),
  "arrow-up": (p) => (
    <Svg {...p}>
      <path {...stroke} d="M12 19V5M6 11l6-6 6 6" />
    </Svg>
  ),
  "arrow-down": (p) => (
    <Svg {...p}>
      <path {...stroke} d="M12 5v14M6 13l6 6 6-6" />
    </Svg>
  ),
  "arrow-left": (p) => (
    <Svg {...p}>
      <path {...stroke} d="M19 12H5M11 6l-6 6 6 6" />
    </Svg>
  ),
  swap: (p) => (
    <Svg {...p}>
      <path {...stroke} d="M7 7h11M7 7l3-3M7 7l3 3M17 17H6M17 17l-3-3M17 17l-3 3" />
    </Svg>
  ),
  "cart-add": (p) => (
    <Svg {...p}>
      <path {...stroke} d="M6 6h15l-1.5 7H8L6 6Z" />
      <path {...stroke} d="M6 6 5 3H2M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM18 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" />
      <path {...stroke} d="M12 10v4M10 12h4" />
    </Svg>
  ),
  edit: (p) => (
    <Svg {...p}>
      <path {...stroke} d="M4 18h4l9.5-9.5a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 14v4Z" />
    </Svg>
  ),
  info: (p) => (
    <Svg {...p}>
      <circle {...stroke} cx="12" cy="12" r="8" />
      <path {...stroke} d="M12 10v6M12 8h.01" />
    </Svg>
  ),
  loading: (p) => (
    <Svg {...p} spin>
      <path {...stroke} d="M12 3a9 9 0 1 0 9 9" />
    </Svg>
  ),
  package: (p) => (
    <Svg {...p}>
      <path {...stroke} d="M4 8.5 12 4l8 4.5-8 4.5-8-4.5Z" />
      <path {...stroke} d="M4 8.5V16l8 4.5 8-4.5V8.5M12 13v7.5" />
    </Svg>
  ),
  location: (p) => (
    <Svg {...p}>
      <path {...stroke} d="M12 21s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10Z" />
      <circle {...stroke} cx="12" cy="11" r="2.5" />
    </Svg>
  ),
  lock: (p) => (
    <Svg {...p}>
      <rect {...stroke} x="6" y="11" width="12" height="9" rx="2" />
      <path {...stroke} d="M8 11V8a4 4 0 0 1 8 0v3" />
    </Svg>
  ),
  list: (p) => (
    <Svg {...p}>
      <path {...stroke} d="M9 6h11M9 12h11M9 18h11M5 6h.01M5 12h.01M5 18h.01" />
    </Svg>
  ),
  tag: (p) => (
    <Svg {...p}>
      <path {...stroke} d="M4 12V5.5A1.5 1.5 0 0 1 5.5 4H12l8 8-8 8-8-8Z" />
      <circle fill="currentColor" cx="9" cy="9" r="1.25" />
    </Svg>
  ),
  "check-circle": (p) => (
    <Svg {...p}>
      <circle {...stroke} cx="12" cy="12" r="8" />
      <path {...stroke} d="m8.5 12 2.5 2.5 5-5" />
    </Svg>
  ),
  inbox: (p) => (
    <Svg {...p}>
      <path {...stroke} d="M4 6h16v12H4V6Z" />
      <path {...stroke} d="M4 14h4l1.5 2h5L16 14h4" />
    </Svg>
  ),
  folder: (p) => (
    <Svg {...p}>
      <path {...stroke} d="M4 8.5V18a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 18V9a1.5 1.5 0 0 0-1.5-1.5H11L9 5.5H5.5A1.5 1.5 0 0 0 4 7v1.5Z" />
    </Svg>
  ),
  "folder-open": (p) => (
    <Svg {...p}>
      <path {...stroke} d="M4 10.5V18a1.5 1.5 0 0 0 1.5 1.5H18A1.5 1.5 0 0 0 19.5 18v-6.5H9.5L7.5 8H5.5A1.5 1.5 0 0 0 4 9.5v1Z" />
    </Svg>
  ),
  warehouse: (p) => (
    <Svg {...p}>
      <path {...stroke} d="M4 10.5 12 5l8 5.5V19H4v-8.5Z" />
      <path {...stroke} d="M9 19v-5h6v5" />
    </Svg>
  ),
  search: (p) => (
    <Svg {...p}>
      <circle {...stroke} cx="11" cy="11" r="6" />
      <path {...stroke} d="m16 16 4 4" />
    </Svg>
  ),
  scan: (p) => (
    <Svg {...p}>
      <path {...stroke} d="M4 7V5a1 1 0 0 1 1-1h2M20 7V5a1 1 0 0 0-1-1h-2M4 17v2a1 1 0 0 0 1 1h2M20 17v2a1 1 0 0 1-1 1h-2" />
      <path {...stroke} d="M7 12h10" />
    </Svg>
  ),
  refresh: (p) => (
    <Svg {...p}>
      <path {...stroke} d="M20 12a8 8 0 1 1-2.3-5.7" />
      <path {...stroke} d="M20 4v5h-5" />
    </Svg>
  ),
  plus: (p) => (
    <Svg {...p}>
      <path {...stroke} d="M12 5v14M5 12h14" />
    </Svg>
  ),
  "chevron-right": (p) => (
    <Svg {...p}>
      <path {...stroke} d="m9 6 6 6-6 6" />
    </Svg>
  ),
  trash: (p) => (
    <Svg {...p}>
      <path {...stroke} d="M4 7h16M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M7 7l.7 11.5A1.5 1.5 0 0 0 9.2 20h5.6a1.5 1.5 0 0 0 1.5-1.5L17 7" />
    </Svg>
  ),
};

export function FeishuIcon({
  name,
  className,
  size = 20,
}: {
  name: FeishuIconName;
  className?: string;
  size?: number;
}) {
  const Icon = ICONS[name];
  return (
    <span className="feishu-icon-wrap" style={{ fontSize: size }}>
      <Icon className={className} />
    </span>
  );
}
