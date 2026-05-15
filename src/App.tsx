import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import Login from "./pages/Login";
import CleanerDashboardPage from "./pages/CleanerDashboardPage";
import ClockInPage from "./pages/ClockInPage";
import ChatPage from "./pages/ChatPage";
import ManagerDashboardPage from "./pages/ManagerDashboardPage";
import ScannerPage from "./pages/ScannerPage";
import HistoryPage from "./pages/HistoryPage";
import ProfilePage from "./pages/ProfilePage";
import QRLibraryPage from "./pages/QRLibraryPage";
import QRGeneratorPage from "./pages/QRGeneratorPage";
import AreaTasksPage from "./pages/AreaTasksPage";
import NotFound from "./pages/NotFound";
import ManagerActivityPage from "./pages/ManagerActivityPage";
import { Navigate } from "react-router-dom";
import AnalyticsPage from "./pages/AnalyticsPage";
import AdminWeeklySchedulePage from "./pages/AdminWeeklySchedulePage";
import BathroomAssistReportPage from "./pages/BathroomAssistReportPage";
import OpsCalendarPage from "./pages/OpsCalendarPage";
import NewCustomerPage from "./pages/NewCustomerPage";
import PresetsPage from "./pages/PresetsPage";
import UsersPage from "./pages/UsersPage";
import AdminLiveDashboardPage from "./pages/AdminLiveDashboardPage";
import CleanerSchedulePage from "./pages/CleanerSchedulePage";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<Login />} />
          <Route path="/cleaner-dashboard" element={<CleanerDashboardPage />} />
          <Route path="/cleaner-assistance" element={<CleanerDashboardPage />} />
          <Route path="/my-schedule" element={<CleanerSchedulePage />} />
          <Route path="/clock-in" element={<ClockInPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/scanner" element={<ScannerPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/qr-library" element={<QRLibraryPage />} />
          <Route path="/qr-generator" element={<QRGeneratorPage />} />
          <Route path="/area-tasks" element={<AreaTasksPage />} />
          <Route path="/manager-dashboard" element={<ManagerDashboardPage />} />
          <Route path="/ops-dashboard" element={<ManagerDashboardPage />} />
          <Route path="/ops-calendar" element={<OpsCalendarPage />} />
          <Route path="/manager-activity" element={<ManagerActivityPage />} />
          <Route path="/admin-dashboard" element={<Navigate to="/admin/dashboard" replace />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/admin-weekly-schedule" element={<AdminWeeklySchedulePage />} />
          <Route path="/admin/new-customer" element={<NewCustomerPage />} />
          <Route path="/admin/presets" element={<PresetsPage />} />
          <Route path="/admin/users" element={<UsersPage />} />
          <Route path="/admin/dashboard" element={<AdminLiveDashboardPage />} />
          <Route path="/bathroom-assist" element={<BathroomAssistReportPage />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
