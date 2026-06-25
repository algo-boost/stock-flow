export interface DetailActionItem {
  key: string;
  label: string;
  emphasis?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export function DetailBottomActions({ actions }: { actions: DetailActionItem[] }) {
  if (actions.length === 0) return null;

  return (
    <div className="detail-bottom-bar">
      <div className="detail-bottom-actions">
        {actions.map((action) => (
          <button
            key={action.key}
            type="button"
            className={`detail-action-btn${action.emphasis ? " detail-action-btn-emphasis" : ""}`}
            disabled={action.disabled}
            onClick={action.onClick}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}
