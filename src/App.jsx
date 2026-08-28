import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ToastProvider } from "./components/shared/Toast";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import TripsPage from "./pages/operations/Trips";
import DispatchPage from "./pages/operations/Dispatch";
import LiveTrackingPage from "./pages/operations/LiveTracking";
import ExceptionsPage from "./pages/operations/Exceptions";
import VehiclesPage from "./pages/fleet/VehiclesPage";
import DriversPage from "./pages/fleet/DriversPage";
import MaintenancePage from "./pages/fleet/MaintenancePage";
import AvailabilityPage from "./pages/fleet/AvailabilityPage";
import CompliancePage from "./pages/fleet/CompliancePage";
import InventoryPage from "./pages/warehouse/InventoryPage";
import StockMovementsPage from "./pages/warehouse/StockMovementsPage";
import BranchTransfersPage from "./pages/warehouse/BranchTransfersPage";
import ComingSoonPage from "./pages/ComingSoonPage";

function ProtectedRoute({ children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function PublicRoute({ children }) {
  const { user } = useAuth();
  if (user) return <Navigate to="/dashboard" replace />;
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
      <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />

      {/* Operations */}
      <Route path="/operations" element={<ProtectedRoute><Navigate to="/operations/trips" replace /></ProtectedRoute>} />
      <Route path="/operations/trips" element={<ProtectedRoute><TripsPage /></ProtectedRoute>} />
      <Route path="/operations/dispatch" element={<ProtectedRoute><DispatchPage /></ProtectedRoute>} />
      <Route path="/operations/live-tracking" element={<ProtectedRoute><LiveTrackingPage /></ProtectedRoute>} />
      <Route path="/operations/exceptions" element={<ProtectedRoute><ExceptionsPage /></ProtectedRoute>} />

      {/* Fleet */}
      <Route path="/fleet/vehicles" element={<ProtectedRoute><VehiclesPage /></ProtectedRoute>} />
      <Route path="/fleet/drivers" element={<ProtectedRoute><DriversPage /></ProtectedRoute>} />
      <Route path="/fleet/maintenance" element={<ProtectedRoute><MaintenancePage /></ProtectedRoute>} />
      <Route path="/fleet/availability" element={<ProtectedRoute><AvailabilityPage /></ProtectedRoute>} />
      <Route path="/fleet/compliance" element={<ProtectedRoute><CompliancePage /></ProtectedRoute>} />

      {/* Warehouse */}
      <Route path="/warehouse/cargo-release" element={<ProtectedRoute><InventoryPage /></ProtectedRoute>} />
      <Route path="/warehouse/cargo-return" element={<ProtectedRoute><ComingSoonPage title="Cargo Return" /></ProtectedRoute>} />
      <Route path="/warehouse/inventory" element={<ProtectedRoute><InventoryPage /></ProtectedRoute>} />
      <Route path="/warehouse/stock-movements" element={<ProtectedRoute><StockMovementsPage /></ProtectedRoute>} />
      <Route path="/warehouse/transfers" element={<ProtectedRoute><BranchTransfersPage /></ProtectedRoute>} />

      {/* Finance */}
      <Route path="/finance/trip-expenses" element={<ProtectedRoute><ComingSoonPage title="Trip Expenses" /></ProtectedRoute>} />
      <Route path="/finance/expense-vouchers" element={<ProtectedRoute><ComingSoonPage title="Expense Vouchers" /></ProtectedRoute>} />
      <Route path="/finance/invoices" element={<ProtectedRoute><ComingSoonPage title="Invoices" /></ProtectedRoute>} />
      <Route path="/finance/journal-entries" element={<ProtectedRoute><ComingSoonPage title="Journal Entries" /></ProtectedRoute>} />
      <Route path="/finance/bir-eis" element={<ProtectedRoute><ComingSoonPage title="BIR / EIS" /></ProtectedRoute>} />

      {/* Master Data */}
      <Route path="/master-data/customers" element={<ProtectedRoute><ComingSoonPage title="Customers" /></ProtectedRoute>} />
      <Route path="/master-data/suppliers" element={<ProtectedRoute><ComingSoonPage title="Suppliers" /></ProtectedRoute>} />
      <Route path="/master-data/items" element={<ProtectedRoute><ComingSoonPage title="Items" /></ProtectedRoute>} />
      <Route path="/master-data/warehouses" element={<ProtectedRoute><ComingSoonPage title="Warehouses" /></ProtectedRoute>} />
      <Route path="/master-data/chart-of-accounts" element={<ProtectedRoute><ComingSoonPage title="Chart of Accounts" /></ProtectedRoute>} />
      <Route path="/master-data/tax-codes" element={<ProtectedRoute><ComingSoonPage title="Tax Codes" /></ProtectedRoute>} />

      {/* Reports */}
      <Route path="/reports/operations" element={<ProtectedRoute><ComingSoonPage title="Operations Reports" /></ProtectedRoute>} />
      <Route path="/reports/fleet" element={<ProtectedRoute><ComingSoonPage title="Fleet Reports" /></ProtectedRoute>} />
      <Route path="/reports/expenses" element={<ProtectedRoute><ComingSoonPage title="Expense Reports" /></ProtectedRoute>} />
      <Route path="/reports/financial" element={<ProtectedRoute><ComingSoonPage title="Financial Reports" /></ProtectedRoute>} />
      <Route path="/reports/compliance" element={<ProtectedRoute><ComingSoonPage title="Compliance Reports" /></ProtectedRoute>} />

      {/* Administration */}
      <Route path="/admin/companies" element={<ProtectedRoute><ComingSoonPage title="Companies" /></ProtectedRoute>} />
      <Route path="/admin/branches" element={<ProtectedRoute><ComingSoonPage title="Branches" /></ProtectedRoute>} />
      <Route path="/admin/users" element={<ProtectedRoute><ComingSoonPage title="Users" /></ProtectedRoute>} />
      <Route path="/admin/roles" element={<ProtectedRoute><ComingSoonPage title="Roles & Permissions" /></ProtectedRoute>} />
      <Route path="/admin/integrations" element={<ProtectedRoute><ComingSoonPage title="Integrations" /></ProtectedRoute>} />
      <Route path="/admin/settings" element={<ProtectedRoute><ComingSoonPage title="Settings" /></ProtectedRoute>} />
      <Route path="/admin/audit-logs" element={<ProtectedRoute><ComingSoonPage title="Audit Logs" /></ProtectedRoute>} />

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <AppRoutes />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
