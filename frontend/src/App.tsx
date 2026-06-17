import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./components/AuthGate";
import AdminCenterPage from "./pages/AdminCenter";
import ApprovalsPage from "./pages/Approvals";
import DetailPage from "./pages/Detail";
import HistoryPage from "./pages/History";
import InboundPage from "./pages/Inbound";
import LocationsPage from "./pages/Locations";
import OutboundPage from "./pages/Outbound";
import PurchasePage from "./pages/Purchase";
import SearchPage from "./pages/Search";
import TransferPage from "./pages/Transfer";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<SearchPage />} />
          <Route path="/materials/:id" element={<DetailPage />} />
          <Route path="/outbound" element={<OutboundPage />} />
          <Route path="/inbound" element={<InboundPage />} />
          <Route path="/purchase" element={<PurchasePage />} />
          <Route path="/transfer" element={<TransferPage />} />
          <Route path="/locations" element={<LocationsPage />} />
          <Route path="/approvals" element={<ApprovalsPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/admin-center" element={<AdminCenterPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
