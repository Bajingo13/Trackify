/**
 * Navigation tree. Each leaf carries the permission required to see it; a
 * group is shown when at least one of its children is visible. The nav
 * components filter this with the current user's permissions — see
 * `filterNavigation` in components/dashboard/TopNav.
 */
const navigation = [
  {
    label: "Operations",
    children: [
      { label: "Trips", path: "/operations/trips", permission: "trip.read" },
      { label: "Dispatch", path: "/operations/dispatch", permission: "trip.assign" },
      { label: "Live Tracking", path: "/operations/live-tracking", permission: "tracking.read" },
      { label: "Exceptions", path: "/operations/exceptions", permission: "exception.read" },
    ],
  },
  {
    label: "Fleet",
    children: [
      { label: "Vehicles", path: "/fleet/vehicles", permission: "vehicle.read" },
      { label: "Drivers", path: "/fleet/drivers", permission: "driver.read" },
      { label: "Maintenance", path: "/fleet/maintenance", permission: "maintenance.read" },
      { label: "Availability", path: "/fleet/availability", permission: "fleet.availability.read" },
      { label: "Compliance", path: "/fleet/compliance", permission: "compliance.read" },
    ],
  },
  {
    label: "Warehouse",
    children: [
      { label: "Inventory", path: "/warehouse/inventory", permission: "inventory.read" },
      { label: "Stock Movements", path: "/warehouse/stock-movements", permission: "stockmovement.read" },
      { label: "Branch Transfers", path: "/warehouse/transfers", permission: "transfer.read" },
      { label: "Cargo Release", path: "/warehouse/cargo-release", permission: "cargo.release" },
      { label: "Cargo Return", path: "/warehouse/cargo-return", permission: "cargo.return" },
    ],
  },
  {
    label: "Finance",
    children: [
      { label: "Trip Expenses", path: "/finance/trip-expenses", permission: "expense.read" },
      { label: "Expense Vouchers", path: "/finance/expense-vouchers", permission: "voucher.read" },
      { label: "Invoices", path: "/finance/invoices", permission: "invoice.read" },
      { label: "Journal Entries", path: "/finance/journal-entries", permission: "journal.read" },
      { label: "BIR / EIS", path: "/finance/bir-eis", permission: "bir.read" },
    ],
  },
  {
    label: "Master Data",
    children: [
      { label: "Customers", path: "/master-data/customers", permission: "customer.read" },
      { label: "Suppliers", path: "/master-data/suppliers", permission: "supplier.read" },
      { label: "Items", path: "/master-data/items", permission: "item.read" },
      { label: "Warehouses", path: "/master-data/warehouses", permission: "warehousemd.read" },
      { label: "Chart of Accounts", path: "/master-data/chart-of-accounts", permission: "coa.read" },
      { label: "Tax Codes", path: "/master-data/tax-codes", permission: "taxcode.read" },
    ],
  },
  {
    label: "Reports",
    children: [
      { label: "Operations", path: "/reports/operations", permission: "report.operations" },
      { label: "Fleet", path: "/reports/fleet", permission: "report.fleet" },
      { label: "Expenses", path: "/reports/expenses", permission: "report.finance" },
      { label: "Financial", path: "/reports/financial", permission: "report.finance" },
      { label: "Compliance", path: "/reports/compliance", permission: "report.compliance" },
    ],
  },
  {
    label: "Administration",
    children: [
      { label: "Companies", path: "/admin/companies", permission: "company.read" },
      { label: "Branches", path: "/admin/branches", permission: "branch.read" },
      { label: "Users", path: "/admin/users", permission: "user.read" },
      { label: "Roles & Permissions", path: "/admin/roles", permission: "role.read" },
      { label: "Integrations", path: "/admin/integrations", permission: "integration.read" },
      { label: "Settings", path: "/admin/settings", permission: "settings.read" },
    ],
  },
  // Its own top-level item — several non-admin roles (Branch Manager, Approver,
  // Finance, Auditor) hold audit.read, and this kept pulling "Administration"
  // into their menu even though nothing else in it was visible to them.
  { label: "Audit Log", path: "/admin/audit-logs", permission: "audit.read" },
];

/** Prune the tree to what `can(permission)` allows. */
export function filterNavigation(tree, can) {
  return tree
    .map((group) => {
      if (!group.children) {
        return !group.permission || can(group.permission) ? group : null;
      }
      const children = group.children.filter((c) => !c.permission || can(c.permission));
      return children.length ? { ...group, children } : null;
    })
    .filter(Boolean);
}

export default navigation;
