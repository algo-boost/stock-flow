/** 启动性能计时器 — 记录各阶段耗时并在页面顶部展示 */
interface PerfEntry { label: string; ms: number }
let _entries: PerfEntry[] = [];
let _t0 = 0;
let _last = 0;

export function perfStart() {
  _t0 = performance.now();
  _last = _t0;
  _entries = [];
}

export function perfMark(label: string) {
  const now = performance.now();
  _entries.push({ label, ms: now - _last });
  _last = now;
}

export function perfDone() {
  _entries.push({ label: "总计", ms: performance.now() - _t0 });
}

export function getPerfEntries(): PerfEntry[] {
  return _entries;
}

export function getPerfTotal(): number {
  return _entries.length > 0 ? _entries[_entries.length - 1].ms : 0;
}
