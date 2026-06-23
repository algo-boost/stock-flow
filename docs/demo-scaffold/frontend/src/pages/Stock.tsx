import { useState, useEffect } from "react";
import { List, DotLoading } from "antd-mobile";
import { getInventory, getLocations } from "../api";

export default function StockPage() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const data = await getInventory();
        setItems(Array.isArray(data) ? data : []);
      } catch (e) { console.error(e); }
      setLoading(false);
    })();
  }, []);

  return (
    <div style={{ padding: 12 }}>
      <h2 style={{ margin: "8px 0 16px" }}>库存概览</h2>
      {loading && <div style={{ textAlign: "center", padding: 20 }}><DotLoading /></div>}
      <List>
        {items.map((item: any, i: number) => (
          <List.Item
            key={item.material_id + (item.location_id || "") + i}
            description={`库位: ${item.location_name || "-"} · 数量: ${item.quantity}`}
          >
            {item.material_name || item.material_id}
          </List.Item>
        ))}
        {!loading && items.length === 0 && (
          <div style={{ textAlign: "center", padding: 40, color: "#999" }}>暂无库存数据</div>
        )}
      </List>
    </div>
  );
}
