import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Login from "./pages/Login";
import CleanerDashboardPage from "./pages/CleanerDashboardPage";
import ClockInPage from "./pages/ClockInPage";
import ChatPage from "./pages/ChatPage";
import ManagerDashboardPage from "./pages/ManagerDashboardPage";
import ScannerPage from "./pages/ScannerPage";
import HistoryPage from "./pages/HistoryPage";
import ProfilePage from "./pages/ProfilePage";
import QRLibraryPage from "./pages/QRLibraryPage";
import NotFound from "./pages/NotFound";
import { Navigate } from "react-router-dom";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<Login />} />
          <Route path="/cleaner-dashboard" element={<CleanerDashboardPage />} />
          <Route path="/clock-in" element={<ClockInPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/scanner" element={<ScannerPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/qr-library" element={<QRLibraryPage />} />
          <Route path="/manager-dashboard" element={<ManagerDashboardPage />} />
          <Route path="/admin-dashboard" element={<ManagerDashboardPage />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
