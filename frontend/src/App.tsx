import { BrowserRouter, Navigate, Route, Routes, useSearchParams } from "react-router-dom";
import { AuthProvider } from "./components/AuthGate";
import AdminCenterPage from "./pages/AdminCenter";
import DetailPage from "./pages/Detail";
import HistoryPage from "./pages/History";
import PendingReturnsPage from "./pages/PendingReturns";
import LocationFormPage from "./pages/LocationForm";
import LocationsPage from "./pages/Locations";
import PurchasePage from "./pages/Purchase";
import SearchPage from "./pages/Search";
import StockPage from "./pages/Stock";

function TransferRedirect() {
  const [params] = useSearchParams();
  const materialId = params.get("material_id");
  const next = new URLSearchParams({ tab: "transfer" });
  if (materialId) next.set("material_id", materialId);
  return <Navigate to={`/locations?${next.toString()}`} replace />;
}

function StockRedirect({ tab }: { tab?: "inbound" | "outbound" }) {
  const [params] = useSearchParams();
  const next = new URLSearchParams();
  if (tab === "inbound") next.set("tab", "inbound");
  const materialId = params.get("material_id");
  if (materialId) next.set("material_id", materialId);
  const qs = next.toString();
  return <Navigate to={qs ? `/stock?${qs}` : "/stock"} replace />;
}

function ApprovalsRedirect() {
  return <Navigate to="/admin-center" replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<SearchPage />} />
          <Route path="/materials/:id" element={<DetailPage />} />
          <Route path="/stock" element={<StockPage />} />
          <Route path="/outbound" element={<StockRedirect />} />
          <Route path="/inbound" element={<StockRedirect tab="inbound" />} />
          <Route path="/purchase" element={<PurchasePage />} />
          <Route path="/transfer" element={<TransferRedirect />} />
          <Route path="/locations/new" element={<LocationFormPage />} />
          <Route path="/locations/:id/edit" element={<LocationFormPage />} />
          <Route path="/locations" element={<LocationsPage />} />
          <Route path="/approvals" element={<ApprovalsRedirect />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/returns" element={<PendingReturnsPage />} />
          <Route path="/admin-center" element={<AdminCenterPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
