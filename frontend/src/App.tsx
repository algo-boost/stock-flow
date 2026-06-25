import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes, useSearchParams } from "react-router-dom";
import { AuthProvider } from "./components/AuthGate";
import { PageLoadFallback } from "./components/PageLoadFallback";
import { UndoToast } from "./components/UndoToast";

const DetailPage = lazy(() => import("./pages/Detail"));
const HistoryPage = lazy(() => import("./pages/History"));
const HistoryTransactionResultsPage = lazy(() => import("./pages/HistoryTransactionResults"));
const LocationFormPage = lazy(() => import("./pages/LocationForm"));
const ManagePage = lazy(() => import("./pages/Manage"));
const PurchasePage = lazy(() => import("./pages/Purchase"));
const LocationShelvesPage = lazy(() => import("./pages/LocationShelves"));
const SearchPage = lazy(() => import("./pages/Search"));
const StockPage = lazy(() => import("./pages/Stock"));
const NotFoundPage = lazy(() => import("./pages/NotFound"));

function PageFallback() {
  return <PageLoadFallback />;
}

function TransferRedirect() {
  const [params] = useSearchParams();
  const materialId = params.get("material_id");
  const next = new URLSearchParams({ tab: "transfer" });
  if (materialId) next.set("material_id", materialId);
  return <Navigate to={`/stock?${next.toString()}`} replace />;
}

function StagingRedirect() {
  return <Navigate to="/stock?tab=staging" replace state={{ materialBackTo: "/" }} />;
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
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/" element={<SearchPage />} />
            <Route path="/materials/:id" element={<DetailPage />} />
            <Route path="/stock" element={<StockPage />} />
            <Route path="/outbound" element={<StockRedirect />} />
            <Route path="/inbound" element={<StockRedirect tab="inbound" />} />
            <Route path="/transfer" element={<TransferRedirect />} />
            <Route path="/staging" element={<StagingRedirect />} />
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
            <Route path="/history/transactions" element={<HistoryTransactionResultsPage />} />
            <Route path="/returns" element={<Navigate to="/history?view=returns" replace />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
}
