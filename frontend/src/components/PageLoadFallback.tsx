import { CardSkeleton } from "./ui";

/** 路由懒加载时的占位，避免全屏空白 */
export function PageLoadFallback() {
  return (
    <div className="page page-loading-shell">
      <CardSkeleton count={3} />
    </div>
  );
}
