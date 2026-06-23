import { useEffect, useState } from "react";
import { getPerfEntries } from "../utils/perf";

export function PerfBar() {
  const [visible, setVisible] = useState(false);
  const [entries, setEntries] = useState<ReturnType<typeof getPerfEntries>>([]);

  useEffect(() => {
    const timer = setInterval(() => {
      const e = getPerfEntries();
      if (e.length >= 2) {
        setEntries(e);
        setVisible(true);
        clearInterval(timer);
      }
    }, 300);
    return () => clearInterval(timer);
  }, []);

  if (!visible || entries.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 100,
        left: 16,
        right: 16,
        zIndex: 9998,
        background: "rgba(31,35,41,0.92)",
        color: "#fff",
        borderRadius: 10,
        padding: "10px 14px",
        fontSize: 12,
        lineHeight: 1.6,
        backdropFilter: "blur(10px)",
        display: "flex",
        flexWrap: "wrap",
        gap: "4px 12px",
        pointerEvents: "none",
      }}
    >
      {entries.map((e) => (
        <span key={e.label} style={{ whiteSpace: "nowrap" }}>
          <span style={{ opacity: 0.6 }}>{e.label}</span>{" "}
          <span style={{ fontWeight: 700, color: e.ms > 3000 ? "#ff7d00" : "#34d399" }}>
            {(e.ms / 1000).toFixed(1)}s
          </span>
        </span>
      ))}
    </div>
  );
}
