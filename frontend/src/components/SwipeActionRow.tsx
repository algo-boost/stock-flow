import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type TouchEvent,
} from "react";

export type SwipeRowAction = {
  key: string;
  label: string;
  tone?: "default" | "primary" | "danger";
  disabled?: boolean;
  onClick: () => void;
};

type SwipeActionRowProps = {
  rowKey: string;
  openKey: string | null;
  onOpenChange: (key: string | null) => void;
  actions: SwipeRowAction[];
  children: ReactNode;
  className?: string;
  contentClassName?: string;
};

const SWIPE_START = 8;
const SWIPE_COMMIT_RATIO = 0.28;

export function SwipeActionRow({
  rowKey,
  openKey,
  onOpenChange,
  actions,
  children,
  className = "",
  contentClassName = "",
}: SwipeActionRowProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const [actionWidth, setActionWidth] = useState(0);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef({
    startX: 0,
    startY: 0,
    baseOffset: 0,
    tracking: false,
    moved: false,
  });

  const isOpen = openKey === rowKey;

  useEffect(() => {
    const node = actionsRef.current;
    if (!node) return;
    const update = () => setActionWidth(node.offsetWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [actions]);

  useEffect(() => {
    if (dragging) return;
    setOffset(isOpen ? -actionWidth : 0);
  }, [isOpen, actionWidth, dragging]);

  useEffect(() => {
    if (!openKey) return;
    const onDocTouch = (event: Event) => {
      const root = rootRef.current;
      if (root && !root.contains(event.target as Node)) {
        onOpenChange(null);
      }
    };
    document.addEventListener("touchstart", onDocTouch, { passive: true });
    return () => document.removeEventListener("touchstart", onDocTouch);
  }, [openKey, onOpenChange]);

  const onTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    if (actionWidth <= 0) return;
    if (openKey && openKey !== rowKey) {
      onOpenChange(null);
    }
    dragRef.current = {
      startX: event.touches[0].clientX,
      startY: event.touches[0].clientY,
      baseOffset: isOpen ? -actionWidth : 0,
      tracking: true,
      moved: false,
    };
  };

  const onTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag.tracking || actionWidth <= 0) return;

    const dx = event.touches[0].clientX - drag.startX;
    const dy = event.touches[0].clientY - drag.startY;

    if (!drag.moved) {
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > SWIPE_START) {
        drag.tracking = false;
        return;
      }
      if (Math.abs(dx) <= SWIPE_START) return;
      drag.moved = true;
      setDragging(true);
    }

    event.preventDefault();
    const next = Math.min(0, Math.max(-actionWidth, drag.baseOffset + dx));
    setOffset(next);
  };

  const finishDrag = (event?: TouchEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const moved = drag.moved;
    drag.tracking = false;
    setDragging(false);

    if (moved) {
      event?.preventDefault();
    }

    if (!moved) {
      if (isOpen) onOpenChange(null);
      return;
    }

    if (offset <= -actionWidth * SWIPE_COMMIT_RATIO) {
      onOpenChange(rowKey);
      return;
    }

    onOpenChange(null);
    setOffset(0);
  };

  const runAction = (action: SwipeRowAction) => {
    onOpenChange(null);
    setOffset(0);
    action.onClick();
  };

  return (
    <div className={`swipe-row ${className}`.trim()} ref={rootRef}>
      <div className="swipe-row-actions" ref={actionsRef} aria-hidden={!isOpen && offset === 0}>
        {actions.map((action) => (
          <button
            key={action.key}
            type="button"
            className={`swipe-row-action swipe-row-action-${action.tone ?? "default"}`}
            disabled={action.disabled}
            onClick={() => runAction(action)}
          >
            {action.label}
          </button>
        ))}
      </div>
      <div
        className={`swipe-row-content ${dragging ? "is-dragging" : ""} ${contentClassName}`.trim()}
        style={{ transform: `translate3d(${offset}px, 0, 0)` } as CSSProperties}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={(event) => finishDrag(event)}
        onTouchCancel={() => finishDrag()}
      >
        {children}
      </div>
    </div>
  );
}
