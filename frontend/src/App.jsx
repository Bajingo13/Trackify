import { lazy, Suspense, useEffect } from "react"
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { AuthProvider, useAuth } from "./context/AuthContext"
import AgreementGate from "./components/legal/AgreementGate"
import { ToastProvider } from "./components/shared/Toast"
import RequirePermission from "./auth/RequirePermission"
// Imported from its own module rather than ./components/settings, so the barrel
// does not pull the whole Settings component set into the entry chunk.
import SettingsGuard from "./components/settings/SettingsGuard"

const LoginPage = lazy(() => import("./pages/LoginPage"))
const DriverApp = lazy(() => import("./driver/DriverApp"))
const DashboardPage = lazy(() => import("./pages/DashboardPage"))

const TripsPage = lazy(() => import("./pages/operations/TripsPage"))
const DispatchPage = lazy(() => import("./pages/operations/Dispatch"))
const LiveTrackingPage = lazy(() => import("./pages/operations/LiveTracking"))
const ExceptionsPage = lazy(() => import("./pages/operations/Exceptions"))
const VehiclesPage = lazy(() => import("./pages/fleet/VehiclesPage"))
const DriversPage = lazy(() => import("./pages/fleet/DriversPage"))
const MaintenancePage = lazy(() => import("./pages/fleet/MaintenancePage"))
const AvailabilityPage = lazy(() => import("./pages/fleet/AvailabilityPage"))
const CompliancePage = lazy(() => import("./pages/fleet/CompliancePage"))
const InventoryPage = lazy(() => import("./pages/warehouse/InventoryPage"))
const StockMovementsPage = lazy(
  () => import("./pages/warehouse/StockMovementsPage"),
)
const BranchTransfersPage = lazy(
  () => import("./pages/warehouse/BranchTransfersPage"),
)
const CargoPage = lazy(() => import("./pages/warehouse/CargoPage"))
const CompaniesPage = lazy(() => import("./pages/admin/CompaniesPage"))
const BranchesPage = lazy(() => import("./pages/admin/BranchesPage"))
const UsersPage = lazy(() => import("./pages/admin/UsersPage"))
const RolesPage = lazy(() => import("./pages/admin/RolesPage"))
const AuditLogsPage = lazy(() => import("./pages/admin/AuditLogsPage"))
const SettingsLayout = lazy(
  () => import("./pages/admin/settings/SettingsLayout"),
)
const SettingsOverview = lazy(
  () => import("./pages/admin/settings/SettingsOverview"),
)
const MyProfilePage = lazy(() => import("./pages/admin/settings/MyProfilePage"))
const PreferencesPage = lazy(
  () => import("./pages/admin/settings/PreferencesPage"),
)
const NotificationsPage = lazy(
  () => import("./pages/admin/settings/NotificationsPage"),
)
const IntegrationsPage = lazy(
  () => import("./pages/admin/settings/IntegrationsPage"),
)
const GeneralSettingsPage = lazy(
  () => import("./pages/admin/settings/GeneralSettingsPage"),
)
const CustomersPage = lazy(() => import("./pages/master-data/CustomersPage"))
const SuppliersPage = lazy(() =>
  import("./pages/master-data/masterDataPages").then((m) => ({
    default: m.SuppliersPage,
  })),
)
const ItemsPage = lazy(() =>
  import("./pages/master-data/masterDataPages").then((m) => ({
    default: m.ItemsPage,
  })),
)
const WarehousesPage = lazy(() =>
  import("./pages/master-data/masterDataPages").then((m) => ({
    default: m.WarehousesPage,
  })),
)
const ChartOfAccountsPage = lazy(() =>
  import("./pages/master-data/masterDataPages").then((m) => ({
    default: m.ChartOfAccountsPage,
  })),
)
const TaxCodesPage = lazy(() =>
  import("./pages/master-data/masterDataPages").then((m) => ({
    default: m.TaxCodesPage,
  })),
)
const OperationsReportsPage = lazy(
  () => import("./pages/reports/OperationsReportsPage"),
)
const FleetReportsPage = lazy(() => import("./pages/reports/FleetReportsPage"))
const ComplianceReportsPage = lazy(
  () => import("./pages/reports/ComplianceReportsPage"),
)
const ExpenseReportsPage = lazy(
  () => import("./pages/reports/ExpenseReportsPage"),
)
const FinancialReportsPage = lazy(
  () => import("./pages/reports/FinancialReportsPage"),
)
const TripExpensesPage = lazy(() => import("./pages/finance/TripExpensesPage"))
const ExpenseVouchersPage = lazy(
  () => import("./pages/finance/ExpenseVouchersPage"),
)
const InvoicesPage = lazy(() => import("./pages/finance/InvoicesPage"))
const JournalEntriesPage = lazy(
  () => import("./pages/finance/JournalEntriesPage"),
)
const BirEisPage = lazy(() => import("./pages/finance/BirEisPage"))

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
  ["/warehouse/cargo-release", "cargo.release", <CargoPage mode="release" />],
  ["/warehouse/cargo-return", "cargo.return", <CargoPage mode="return" />],

  ["/finance/trip-expenses", "expense.read", <TripExpensesPage />],
  ["/finance/expense-vouchers", "voucher.read", <ExpenseVouchersPage />],
  ["/finance/invoices", "invoice.read", <InvoicesPage />],
  ["/finance/journal-entries", "journal.read", <JournalEntriesPage />],
  ["/finance/bir-eis", "bir.read", <BirEisPage />],

  ["/master-data/customers", "customer.read", <CustomersPage />],
  ["/master-data/suppliers", "supplier.read", <SuppliersPage />],
  ["/master-data/items", "item.read", <ItemsPage />],
  ["/master-data/warehouses", "warehousemd.read", <WarehousesPage />],
  ["/master-data/chart-of-accounts", "coa.read", <ChartOfAccountsPage />],
  ["/master-data/tax-codes", "taxcode.read", <TaxCodesPage />],

  ["/reports/operations", "report.operations", <OperationsReportsPage />],
  ["/reports/fleet", "report.fleet", <FleetReportsPage />],
  ["/reports/expenses", "report.finance", <ExpenseReportsPage />],
  ["/reports/financial", "invoice.read", <FinancialReportsPage />],
  ["/reports/compliance", "report.compliance", <ComplianceReportsPage />],

  ["/admin/audit-logs", "audit.read", <AuditLogsPage />],
]

/** Old Administration URLs now live inside the Settings workspace. */
const SETTINGS_REDIRECTS = [
  ["/admin/companies", "/admin/settings/companies"],
  ["/admin/branches", "/admin/settings/branches"],
  ["/admin/users", "/admin/settings/users"],
  ["/admin/roles", "/admin/settings/roles"],
  ["/admin/integrations", "/admin/settings/integrations"],
]

function ProtectedRoute({ children }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  // Section 2.1 of the Agreement: an account is not activated until the Terms
  // of Service and Data Privacy Policy have been accepted. Gating inside the
  // route guard rather than on a route of its own means there is nothing to
  // navigate around — every protected screen passes through here.
  return <AgreementGate>{children}</AgreementGate>
}

function PublicRoute({ children }) {
  const { user } = useAuth()
  if (user) return <Navigate to="/dashboard" replace />
  return children
}

function AppRoutes() {
  const { user, refresh } = useAuth()

  // Keep effective permissions current (e.g. after a role change) without a re-login.
  useEffect(() => {
    if (user) refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Suspense
      fallback={
        <div role="status" className="app-route-loading">
          Loading Trackify…
        </div>
      }
    >
      <Routes>
        <Route
          path="/login"
          element={
            <PublicRoute>
              <LoginPage />
            </PublicRoute>
          }
        />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/operations"
          element={
            <ProtectedRoute>
              <Navigate to="/operations/trips" replace />
            </ProtectedRoute>
          }
        />

        {ROUTES.map(([path, permission, element]) => (
          <Route
            key={path}
            path={path}
            element={
              <RequirePermission permission={permission}>
                {element}
              </RequirePermission>
            }
          />
        ))}

        {SETTINGS_REDIRECTS.map(([from, to]) => (
          <Route
            key={from}
            path={from}
            element={<Navigate to={to} replace />}
          />
        ))}

        <Route
          path="/admin/settings"
          element={
            <ProtectedRoute>
              <SettingsLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<SettingsOverview />} />
          <Route path="profile" element={<MyProfilePage />} />
          <Route path="preferences" element={<PreferencesPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route
            path="companies"
            element={
              <SettingsGuard permission="company.read">
                <CompaniesPage />
              </SettingsGuard>
            }
          />
          <Route
            path="branches"
            element={
              <SettingsGuard permission="branch.read">
                <BranchesPage />
              </SettingsGuard>
            }
          />
          <Route
            path="users"
            element={
              <SettingsGuard permission="user.read">
                <UsersPage />
              </SettingsGuard>
            }
          />
          <Route
            path="roles"
            element={
              <SettingsGuard permission="role.read">
                <RolesPage />
              </SettingsGuard>
            }
          />
          <Route
            path="integrations"
            element={
              <SettingsGuard permission="integration.read">
                <IntegrationsPage />
              </SettingsGuard>
            }
          />
          <Route
            path="general"
            element={
              <SettingsGuard permission="settings.read">
                <GeneralSettingsPage />
              </SettingsGuard>
            }
          />
          <Route
            path="audit-logs"
            element={
              <SettingsGuard permission="audit.read">
                <AuditLogsPage embedded />
              </SettingsGuard>
            }
          />
        </Route>

        <Route path="/driver/*" element={<DriverApp />} />

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  )
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
  )
}
