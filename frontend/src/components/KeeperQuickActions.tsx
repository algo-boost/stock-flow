import { useNavigate } from "react-router-dom";
import { FeishuIcon, type FeishuIconName } from "./FeishuIcon";
import { openStockPage } from "../utils/detailNavigation";

interface QuickAction {
  key: string;
  label: string;
  icon: FeishuIconName;
  primary?: boolean;
  onClick: () => void;
}

interface KeeperQuickActionsProps {
  isAdmin?: boolean;
}

/** 库管 / 管理员首页快捷入口 */
export function KeeperQuickActions({ isAdmin = false }: KeeperQuickActionsProps) {
  const navigate = useNavigate();
  const back = "/";

  const actions: QuickAction[] = [
    {
      key: "staging",
      label: "暂存上架",
      icon: "warehouse",
      primary: true,
      onClick: () => navigate("/staging"),
    },
    {
      key: "inbound",
      label: "入库",
      icon: "arrow-down",
      onClick: () => openStockPage(navigate, "inbound", { materialBackTo: back, fromLabel: "首页" }),
    },
    {
      key: "outbound",
      label: "出库",
      icon: "arrow-up",
      onClick: () => openStockPage(navigate, "outbound", { materialBackTo: back, fromLabel: "首页" }),
    },
    {
      key: "returns",
      label: "待归还",
      icon: "swap",
      onClick: () => navigate("/history?view=returns"),
    },
    {
      key: "locations",
      label: "库位管理",
      icon: "location",
      onClick: () => navigate("/manage?tab=locations"),
    },
    ...(isAdmin
      ? [
          {
            key: "purchase",
            label: "进货",
            icon: "cart-add",
            onClick: () => navigate("/purchase?from=home"),
          } as QuickAction,
        ]
      : []),
  ];

  return (
    <div className="home-keeper-quick" aria-label="库管快捷操作">
      <div className="home-keeper-quick-scroll">
        {actions.map((action) => (
          <button
            key={action.key}
            type="button"
            className={`home-keeper-quick-btn${action.primary ? " home-keeper-quick-btn-primary" : ""}`}
            onClick={action.onClick}
          >
            <FeishuIcon name={action.icon} size={18} />
            <span>{action.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
