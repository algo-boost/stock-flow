import { useNavigate } from "react-router-dom";
import { Button } from "antd-mobile";
import { Layout } from "../components/Layout";
import { EmptyState } from "../components/ui";

export default function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <Layout title="页面不存在" backTo="/">
      <EmptyState
        icon="inbox"
        text="找不到该页面"
        hint="链接可能已失效，或页面已迁移"
        actions={[
          { label: "返回首页", onClick: () => navigate("/") },
          { label: "查看历史", onClick: () => navigate("/history") },
        ]}
      />
      <div className="not-found-actions">
        <Button block fill="outline" onClick={() => navigate(-1)}>
          返回上一页
        </Button>
      </div>
    </Layout>
  );
}
