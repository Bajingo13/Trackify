const navigation = [
  {
    label: "Operations",
    children: [
      { label: "Trips", path: "/operations/trips" },
      { label: "Dispatch", path: "/operations/dispatch" },
      { label: "Live Tracking", path: "/operations/live-tracking" },
      { label: "Exceptions", path: "/operations/exceptions" },
    ],
  },
  {
    label: "Fleet",
    children: [
      { label: "Vehicles", path: "/fleet/vehicles" },
      { label: "Drivers", path: "/fleet/drivers" },
      { label: "Maintenance", path: "/fleet/maintenance" },
      { label: "Availability", path: "/fleet/availability" },
      { label: "Compliance", path: "/fleet/compliance" },
    ],
  },
  {
    label: "Warehouse",
    children: [
      { label: "Inventory", path: "/warehouse/inventory" },
      { label: "Stock Movements", path: "/warehouse/stock-movements" },
      { label: "Branch Transfers", path: "/warehouse/transfers" },
      { label: "Cargo Release", path: "/warehouse/cargo-release" },
      { label: "Cargo Return", path: "/warehouse/cargo-return" },
    ],
  },
  {
    label: "Finance",
    children: [
      { label: "Trip Expenses", path: "/finance/trip-expenses" },
      { label: "Expense Vouchers", path: "/finance/expense-vouchers" },
      { label: "Invoices", path: "/finance/invoices" },
      { label: "Journal Entries", path: "/finance/journal-entries" },
      { label: "BIR / EIS", path: "/finance/bir-eis" },
    ],
  },
  {
    label: "Master Data",
    children: [
      { label: "Customers", path: "/master-data/customers" },
      { label: "Suppliers", path: "/master-data/suppliers" },
      { label: "Items", path: "/master-data/items" },
      { label: "Warehouses", path: "/master-data/warehouses" },
      { label: "Chart of Accounts", path: "/master-data/chart-of-accounts" },
      { label: "Tax Codes", path: "/master-data/tax-codes" },
    ],
  },
  {
    label: "Reports",
    children: [
      { label: "Operations", path: "/reports/operations" },
      { label: "Fleet", path: "/reports/fleet" },
      { label: "Expenses", path: "/reports/expenses" },
      { label: "Financial", path: "/reports/financial" },
      { label: "Compliance", path: "/reports/compliance" },
    ],
  },
  {
    label: "Administration",
    children: [
      { label: "Companies", path: "/admin/companies" },
      { label: "Branches", path: "/admin/branches" },
      { label: "Users", path: "/admin/users" },
      { label: "Roles & Permissions", path: "/admin/roles" },
      { label: "Integrations", path: "/admin/integrations" },
      { label: "Settings", path: "/admin/settings" },
      { label: "Audit Logs", path: "/admin/audit-logs" },
    ],
  },
];

export default navigation;
