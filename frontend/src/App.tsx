import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./components/AuthGate";
import DetailPage from "./pages/Detail";
import InboundPage from "./pages/Inbound";
import OutboundPage from "./pages/Outbound";
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
          <Route path="/transfer" element={<TransferPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
