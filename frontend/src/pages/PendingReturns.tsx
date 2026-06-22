import { Navigate } from "react-router-dom";
import { useAuth } from "../components/AuthGate";
import { Layout } from "../components/Layout";
import { PendingReturnsPanel } from "../components/PendingReturnsPanel";

export default function PendingReturnsPage() {
  const { user, loading } = useAuth();

  if (!loading && user && user.role !== "USER") {
    return <Navigate to="/history?view=returns" replace />;
  }

  return (
    <Layout title="待归还">
      <PendingReturnsPanel />
    </Layout>
  );
}
