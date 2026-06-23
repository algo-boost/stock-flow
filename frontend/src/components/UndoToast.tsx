import { useEffect, useState } from "react";

interface UndoAction {
  message: string;
  undoLabel?: string;
  onUndo: () => void;
  id: number;
}

let _push: ((a: UndoAction) => void) | null = null;
let _nextId = 0;

/** 在任何组件外调用，弹出撤销提示（不自动消失） */
export function showUndo(message: string, onUndo: () => void, undoLabel = "撤销") {
  _push?.({ message, onUndo, undoLabel, id: ++_nextId });
}

/** 全局撤销提示容器，挂一次在 App 级即可 */
export function UndoToast() {
  const [actions, setActions] = useState<UndoAction[]>([]);

  useEffect(() => {
    _push = (a) => setActions((prev) => [...prev, a]);
    return () => { _push = null; };
  }, []);

  if (actions.length === 0) return null;
  const current = actions[actions.length - 1];

  return (
    <div className="undo-toast" key={current.id}>
      <span>{current.message}</span>
      <button
        type="button"
        onClick={() => {
          current.onUndo();
          setActions((prev) => prev.filter((a) => a.id !== current.id));
        }}
      >
        {current.undoLabel ?? "撤销"}
      </button>
      <button
        type="button"
        className="undo-close"
        aria-label="关闭"
        onClick={() => setActions((prev) => prev.filter((a) => a.id !== current.id))}
      >
        ✕
      </button>
    </div>
  );
}
