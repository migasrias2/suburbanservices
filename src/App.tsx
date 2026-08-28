import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import { RequireAuth } from "./components/auth/RequireAuth";
import Login from "./pages/Login";
import CleanerDashboardPage from "./pages/CleanerDashboardPage";
import CleanerHomePage from "./pages/CleanerHomePage";
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
import DashboardAccessPage from "./pages/DashboardAccessPage";
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
          <Route path="/cleaner-dashboard" element={<RequireAuth roles={["cleaner"]}><CleanerHomePage /></RequireAuth>} />
          <Route path="/cleaner-assistance" element={<RequireAuth roles={["cleaner"]}><CleanerDashboardPage /></RequireAuth>} />
          <Route path="/my-schedule" element={<RequireAuth roles={["cleaner"]}><CleanerSchedulePage /></RequireAuth>} />
          <Route path="/clock-in" element={<RequireAuth roles={["cleaner"]}><ClockInPage /></RequireAuth>} />
          <Route path="/chat" element={<RequireAuth><ChatPage /></RequireAuth>} />
          <Route path="/scanner" element={<RequireAuth roles={["cleaner"]}><ScannerPage /></RequireAuth>} />
          <Route path="/history" element={<RequireAuth><HistoryPage /></RequireAuth>} />
          <Route path="/profile" element={<RequireAuth><ProfilePage /></RequireAuth>} />
          <Route path="/qr-library" element={<RequireAuth roles={["manager", "ops_manager", "admin"]}><QRLibraryPage /></RequireAuth>} />
          <Route path="/qr-generator" element={<RequireAuth roles={["manager", "ops_manager", "admin"]}><QRGeneratorPage /></RequireAuth>} />
          <Route path="/area-tasks" element={<RequireAuth roles={["manager", "ops_manager", "admin"]}><AreaTasksPage /></RequireAuth>} />
          <Route path="/manager-dashboard" element={<RequireAuth roles={["manager", "ops_manager", "admin"]}><ManagerDashboardPage /></RequireAuth>} />
          <Route path="/ops-dashboard" element={<RequireAuth roles={["ops_manager", "admin"]}><ManagerDashboardPage /></RequireAuth>} />
          <Route path="/ops-calendar" element={<RequireAuth roles={["ops_manager", "admin"]}><OpsCalendarPage /></RequireAuth>} />
          <Route path="/manager-activity" element={<RequireAuth roles={["manager", "ops_manager", "admin"]}><ManagerActivityPage /></RequireAuth>} />
          <Route path="/admin-dashboard" element={<Navigate to="/admin/dashboard" replace />} />
          <Route path="/analytics" element={<RequireAuth roles={["manager", "ops_manager", "admin"]}><AnalyticsPage /></RequireAuth>} />
          <Route path="/admin-weekly-schedule" element={<RequireAuth roles={["manager", "ops_manager", "admin"]}><AdminWeeklySchedulePage /></RequireAuth>} />
          <Route path="/admin/new-customer" element={<RequireAuth roles={["admin"]}><NewCustomerPage /></RequireAuth>} />
          <Route path="/admin/presets" element={<RequireAuth roles={["admin"]}><PresetsPage /></RequireAuth>} />
          <Route path="/admin/users" element={<RequireAuth roles={["admin"]}><UsersPage /></RequireAuth>} />
          <Route path="/admin/dashboard-access" element={<RequireAuth roles={["admin"]}><DashboardAccessPage /></RequireAuth>} />
          <Route path="/admin/dashboard" element={<RequireAuth roles={["admin"]}><AdminLiveDashboardPage /></RequireAuth>} />
          {/* PUBLIC ON PURPOSE -- DO NOT WRAP IN RequireAuth.
              The URL for this route is printed into the QR codes mounted on
              client bathroom walls (QRGenerator.tsx:22-23 builds it from
              VITE_PUBLIC_APP_URL and bakes it into payload.rawValue at :117).
              Members of the public scan those codes to report a problem; they
              have no account. The page takes all its context from query params,
              its reporter name and contact fields are optional, and
              assistRequestService submits with no auth at all. Gating it sends
              a member of the public to a staff login screen, and the codes are
              already physically deployed so it cannot be fixed by reprinting. */}
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
