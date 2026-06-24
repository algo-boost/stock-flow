import { BrowserRouter, Navigate, Route, Routes, useSearchParams } from "react-router-dom";
import { AuthProvider } from "./components/AuthGate";
import { UndoToast } from "./components/UndoToast";
import DetailPage from "./pages/Detail";
import HistoryPage from "./pages/History";
import LocationFormPage from "./pages/LocationForm";
import ManagePage from "./pages/Manage";
import PurchasePage from "./pages/Purchase";
import LocationShelvesPage from "./pages/LocationShelves";
import SearchPage from "./pages/Search";
import StockPage from "./pages/Stock";

function TransferRedirect() {
  const [params] = useSearchParams();
  const materialId = params.get("material_id");
  const next = new URLSearchParams({ tab: "transfer" });
  if (materialId) next.set("material_id", materialId);
  return <Navigate to={`/stock?${next.toString()}`} replace />;
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

function ShelfListRedirect() {
  return <Navigate to="/" replace state={{ browseBy: "location" as const }} />;
}

function LegacyManageRedirect({ tab }: { tab?: string }) {
  const [params] = useSearchParams();
  const next = new URLSearchParams();
  if (tab) next.set("tab", tab);
  const materialId = params.get("material_id");
  if (materialId) next.set("material_id", materialId);
  const qs = next.toString();
  return <Navigate to={qs ? `/manage?${qs}` : "/manage"} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <UndoToast />
        <Routes>
          <Route path="/" element={<SearchPage />} />
          <Route path="/materials/:id" element={<DetailPage />} />
          <Route path="/stock" element={<StockPage />} />
          <Route path="/outbound" element={<StockRedirect />} />
          <Route path="/inbound" element={<StockRedirect tab="inbound" />} />
          <Route path="/transfer" element={<TransferRedirect />} />
          <Route path="/purchase" element={<PurchasePage />} />
          <Route path="/manage" element={<ManagePage />} />
          <Route path="/shelves" element={<ShelfListRedirect />} />
          <Route path="/shelves/:locationId" element={<LocationShelvesPage />} />
          <Route path="/locations/new" element={<LocationFormPage />} />
          <Route path="/locations/:id/edit" element={<LocationFormPage />} />
          <Route path="/locations" element={<LegacyManageRedirect tab="locations" />} />
          <Route path="/approvals" element={<Navigate to="/history?view=approvals" replace />} />
          <Route path="/admin-center" element={<Navigate to="/manage?tab=dashboard" replace />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/returns" element={<Navigate to="/history?view=returns" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
