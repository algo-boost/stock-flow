import { useState } from "react";
import { SearchBar, Toast } from "antd-mobile";
import { useNavigate } from "react-router-dom";
import { searchMaterials } from "../api";
import type { Material } from "../api/types";
import { useAuth } from "../components/AuthGate";
import { Layout } from "../components/Layout";
import { EmptyState, MaterialCard, PageHero, RolePermissions, SectionCard } from "../components/ui";

export default function SearchPage() {
  const [keyword, setKeyword] = useState("");
  const [items, setItems] = useState<Material[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const navigate = useNavigate();
  const { user, canInbound } = useAuth();

  const onSearch = async (val: string) => {
    setKeyword(val);
    setLoading(true);
    setSearched(true);
    try {
      const data = await searchMaterials(val.trim());
      setItems(data.items);
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "搜索失败" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout title="物料管理">
      <PageHero
        title={`你好，${user?.name ?? "用户"}`}
        subtitle="搜索物料、查看库存、快速出入库"
      />

      {user && (
        <SectionCard title="我的权限">
          <RolePermissions role={user.role} />
        </SectionCard>
      )}

      <div className="quick-actions">
        <button type="button" className="quick-action outbound" onClick={() => navigate("/outbound")}>
          <span className="quick-action-icon">📤</span>
          <span className="quick-action-title">出库领用</span>
          <span className="quick-action-desc">记录项目领料</span>
        </button>
        {canInbound ? (
          <button type="button" className="quick-action" onClick={() => navigate("/inbound")}>
            <span className="quick-action-icon">📥</span>
            <span className="quick-action-title">入库上架</span>
            <span className="quick-action-desc">采购 / 归还入库</span>
          </button>
        ) : (
          <button type="button" className="quick-action" onClick={() => onSearch("")}>
            <span className="quick-action-icon">📋</span>
            <span className="quick-action-title">浏览全部</span>
            <span className="quick-action-desc">查看可用物料</span>
          </button>
        )}
      </div>

      <SectionCard title="搜索物料" subtitle="支持名称、编码、条码">
        <div className="search-card">
          <SearchBar
            placeholder="输入关键词搜索…"
            value={keyword}
            onChange={setKeyword}
            onSearch={onSearch}
            onClear={() => {
              setItems([]);
              setSearched(false);
            }}
          />
        </div>
      </SectionCard>

      <SectionCard
        title={loading ? "搜索中…" : searched ? `找到 ${items.length} 条` : "搜索结果"}
        subtitle={searched ? undefined : "输入关键词或点击「浏览全部」"}
      >
        {!searched && !loading && (
          <EmptyState icon="🔎" text="开始搜索物料" hint="例如：电机、雷达、编码" />
        )}
        {searched && !loading && items.length === 0 && (
          <EmptyState icon="📭" text="没有匹配的物料" hint="换个关键词试试" />
        )}
        {items.map((m) => (
          <MaterialCard
            key={m.id}
            name={m.name}
            code={m.code}
            category={m.category_name}
            unit={m.unit}
            onClick={() => navigate(`/materials/${m.id}`)}
          />
        ))}
      </SectionCard>
    </Layout>
  );
}
