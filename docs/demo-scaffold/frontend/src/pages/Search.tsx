import { useState, useEffect } from "react";
import { SearchBar, List, DotLoading } from "antd-mobile";
import { searchMaterials, getMaterialCatalog } from "../api";

export default function SearchPage() {
  const [keyword, setKeyword] = useState("");
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const data = keyword
          ? await searchMaterials(keyword)
          : await getMaterialCatalog();
        setItems(Array.isArray(data) ? data : (data as any)?.items || []);
      } catch (e) { console.error(e); }
      setLoading(false);
    })();
  }, [keyword]);

  return (
    <div style={{ padding: 12 }}>
      <h2 style={{ margin: "8px 0 16px" }}>物料搜索</h2>
      <SearchBar
        placeholder="输入物料名称或编码"
        value={keyword}
        onChange={setKeyword}
        style={{ "--border-radius": "8px", marginBottom: 16 }}
      />
      {loading && <div style={{ textAlign: "center", padding: 20 }}><DotLoading /></div>}
      <List>
        {items.map((item: any) => (
          <List.Item
            key={item.id || item.record_id}
            description={
              <span style={{ fontSize: 12, color: "#888" }}>
                {item.code && `编码: ${item.code} · `}
                库存: {item.total_quantity ?? item.quantity ?? "-"}
                {item.locations_summary && ` · ${item.locations_summary}`}
              </span>
            }
          >
            {item.name}
          </List.Item>
        ))}
        {!loading && items.length === 0 && (
          <div style={{ textAlign: "center", padding: 40, color: "#999" }}>暂无结果</div>
        )}
      </List>
    </div>
  );
}
