import { useEffect, useState } from "react";
import { Button, SearchBar, Toast } from "antd-mobile";
import { useNavigate } from "react-router-dom";
import { searchMaterials } from "../api";
import type { MaterialSearchItem } from "../api/types";
import { useAuth } from "../components/AuthGate";
import { Layout } from "../components/Layout";
import { EmptyState, MaterialCard, PageHero, RolePermissions, SectionCard } from "../components/ui";

export default function SearchPage() {
  const pageSize = 20;
  const [keyword, setKeyword] = useState("");
  const [items, setItems] = useState<MaterialSearchItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { user, canInbound } = useAuth();

  const loadMaterials = async (q: string, nextPage = 1, append = false) => {
    setLoading(true);
    try {
      const data = await searchMaterials(q.trim(), { page: nextPage, size: pageSize });
      setItems((current) => (append ? [...current, ...data.items] : data.items));
      setPage(data.page);
      setTotal(data.total);
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "搜索失败" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadMaterials("", 1);
  }, []);

  const onSearch = (val: string) => {
    setKeyword(val);
    void loadMaterials(val, 1);
  };

  const loadMore = () => {
    void loadMaterials(keyword, page + 1, true);
  };

  const hasMore = items.length < total;

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
          <>
            <button type="button" className="quick-action" onClick={() => navigate("/inbound")}>
              <span className="quick-action-icon">📥</span>
              <span className="quick-action-title">入库上架</span>
              <span className="quick-action-desc">采购 / 归还入库</span>
            </button>
            <button type="button" className="quick-action" onClick={() => navigate("/transfer")}>
              <span className="quick-action-icon">↔</span>
              <span className="quick-action-title">库内移动</span>
              <span className="quick-action-desc">暂存上架 / 整理库位</span>
            </button>
          </>
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
              setKeyword("");
              void loadMaterials("", 1);
            }}
          />
        </div>
      </SectionCard>

      <SectionCard
        title={loading && items.length === 0 ? "加载中…" : keyword ? `找到 ${total} 条` : `全部物料 ${total} 条`}
        subtitle="默认显示全部物料，搜索后按关键词筛选"
      >
        {!loading && items.length === 0 && (
          <EmptyState icon="📭" text="没有匹配的物料" hint="换个关键词试试" />
        )}
        {items.map((m) => (
          <MaterialCard
            key={m.id}
            name={m.name}
            code={m.code}
            category={m.category_name}
            unit={`库存 ${m.total_quantity} ${m.unit}`}
            stockSummary={m.locations_summary ?? "暂无库存"}
            onClick={() => navigate(`/materials/${m.id}`)}
          />
        ))}
        {hasMore && (
          <div className="load-more">
            <Button loading={loading} fill="outline" block onClick={loadMore}>
              加载更多
            </Button>
          </div>
        )}
      </SectionCard>
    </Layout>
  );
}
