import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ToastProvider } from "./components/shared/Toast";
import RequirePermission from "./auth/RequirePermission";

import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import ComingSoonPage from "./pages/ComingSoonPage";

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
import CompaniesPage from "./pages/admin/CompaniesPage";
import BranchesPage from "./pages/admin/BranchesPage";
import UsersPage from "./pages/admin/UsersPage";
import RolesPage from "./pages/admin/RolesPage";
import AuditLogsPage from "./pages/admin/AuditLogsPage";
import CustomersPage from "./pages/master-data/CustomersPage";

const coming = (title) => <ComingSoonPage title={title} />;

/** [path, permission, element] — permission gate is enforced client-side here
 *  and again by the API on every request the page makes. */
const ROUTES = [
  ["/operations/trips", "trip.read", <TripsPage />],
  ["/operations/dispatch", "trip.assign", <DispatchPage />],
  ["/operations/live-tracking", "tracking.read", <LiveTrackingPage />],
  ["/operations/exceptions", "exception.read", <ExceptionsPage />],

  ["/fleet/vehicles", "vehicle.read", <VehiclesPage />],
  ["/fleet/drivers", "driver.read", <DriversPage />],
  ["/fleet/maintenance", "maintenance.read", <MaintenancePage />],
  ["/fleet/availability", "fleet.availability.read", <AvailabilityPage />],
  ["/fleet/compliance", "compliance.read", <CompliancePage />],

  ["/warehouse/inventory", "inventory.read", <InventoryPage />],
  ["/warehouse/stock-movements", "stockmovement.read", <StockMovementsPage />],
  ["/warehouse/transfers", "transfer.read", <BranchTransfersPage />],
  ["/warehouse/cargo-release", "cargo.release", <InventoryPage />],
  ["/warehouse/cargo-return", "cargo.return", coming("Cargo Return")],

  ["/finance/trip-expenses", "expense.read", coming("Trip Expenses")],
  ["/finance/expense-vouchers", "voucher.read", coming("Expense Vouchers")],
  ["/finance/invoices", "invoice.read", coming("Invoices")],
  ["/finance/journal-entries", "journal.read", coming("Journal Entries")],
  ["/finance/bir-eis", "bir.read", coming("BIR / EIS")],

  ["/master-data/customers", "customer.read", <CustomersPage />],
  ["/master-data/suppliers", "supplier.read", coming("Suppliers")],
  ["/master-data/items", "item.read", coming("Items")],
  ["/master-data/warehouses", "warehousemd.read", coming("Warehouses")],
  ["/master-data/chart-of-accounts", "coa.read", coming("Chart of Accounts")],
  ["/master-data/tax-codes", "taxcode.read", coming("Tax Codes")],

  ["/reports/operations", "report.operations", coming("Operations Reports")],
  ["/reports/fleet", "report.fleet", coming("Fleet Reports")],
  ["/reports/expenses", "report.finance", coming("Expense Reports")],
  ["/reports/financial", "report.finance", coming("Financial Reports")],
  ["/reports/compliance", "report.compliance", coming("Compliance Reports")],

  ["/admin/companies", "company.read", <CompaniesPage />],
  ["/admin/branches", "branch.read", <BranchesPage />],
  ["/admin/users", "user.read", <UsersPage />],
  ["/admin/roles", "role.read", <RolesPage />],
  ["/admin/integrations", "integration.read", coming("Integrations")],
  ["/admin/settings", "settings.read", coming("Settings")],
  ["/admin/audit-logs", "audit.read", <AuditLogsPage />],
];

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
  const { user, refresh } = useAuth();

  // Keep effective permissions current (e.g. after a role change) without a re-login.
  useEffect(() => {
    if (user) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Routes>
      <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
      <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
      <Route path="/operations" element={<ProtectedRoute><Navigate to="/operations/trips" replace /></ProtectedRoute>} />

      {ROUTES.map(([path, permission, element]) => (
        <Route
          key={path}
          path={path}
          element={<RequirePermission permission={permission}>{element}</RequirePermission>}
        />
      ))}

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
