/**
 * Trackify RBAC — single source of truth.
 *
 * - PERMISSION_CATALOG : every permission the system knows about
 * - ROLE_TEMPLATES     : the seeded system roles and the permissions each holds
 * - pure helpers        : resolution logic, no database, unit-testable
 *
 * Migration 005 seeds the catalog + templates into every company. The same
 * data drives company provisioning (companies.controller) so there is exactly
 * one place to change a default.
 */

/** Wildcard permission — a holder is treated as having every permission, everywhere. */
export const SYSTEM_ADMIN = "system.admin";

/* ------------------------------------------------------------------ */
/* Permission catalog                                                  */
/* ------------------------------------------------------------------ */

export const PERMISSION_CATALOG = [
  // operations
  ["trip.read", "View trip tickets"],
  ["trip.create", "Create trip tickets"],
  ["trip.update", "Edit draft trip tickets"],
  ["trip.submit", "Submit trip tickets for validation"],
  ["trip.validate", "Validate submitted trip tickets"],
  ["trip.approve", "Approve trip tickets"],
  ["trip.reject", "Reject trip tickets"],
  ["trip.assign", "Assign drivers and vehicles"],
  ["trip.release", "Release trips for departure"],
  ["trip.cancel", "Cancel trip tickets"],
  ["trip.close", "Operationally close trips"],
  ["tracking.read", "View GPS tracking"],
  ["tracking.update", "Submit GPS / status updates"],
  ["exception.read", "View operational exceptions"],
  ["exception.create", "Raise operational exceptions"],
  ["exception.resolve", "Acknowledge / resolve exceptions"],

  // fleet
  ["vehicle.read", "View vehicles"],
  ["vehicle.manage", "Create and update vehicles"],
  ["driver.read", "View drivers"],
  ["driver.manage", "Create and update drivers"],
  ["maintenance.read", "View maintenance records"],
  ["maintenance.manage", "Schedule and record maintenance"],
  ["fleet.availability.read", "View fleet availability"],
  ["compliance.read", "View compliance / document expiry"],
  ["compliance.manage", "Manage compliance documents"],

  // warehouse
  ["warehouse.read", "View warehouse activity"],
  ["cargo.release", "Release cargo"],
  ["cargo.return", "Process cargo returns"],
  ["inventory.read", "View inventory"],
  ["inventory.manage", "Adjust inventory"],
  ["stockmovement.read", "View stock movements"],
  ["stockmovement.manage", "Record stock movements"],
  ["transfer.read", "View branch transfers"],
  ["transfer.manage", "Create branch transfers"],

  // finance
  ["expense.read", "View trip expenses"],
  ["expense.manage", "Record and edit trip expenses"],
  ["voucher.read", "View expense vouchers"],
  ["voucher.manage", "Create and edit expense vouchers"],
  ["voucher.approve", "Approve expense vouchers"],
  ["invoice.read", "View invoices"],
  ["invoice.manage", "Create and edit invoices"],
  ["journal.read", "View journal entries"],
  ["journal.manage", "Create and edit journal entries"],
  ["bir.read", "View BIR / EIS records"],
  ["bir.manage", "Manage BIR / EIS records"],

  // master data
  ["customer.read", "View customers"],
  ["customer.manage", "Create and update customers"],
  ["supplier.read", "View suppliers"],
  ["supplier.manage", "Create and update suppliers"],
  ["item.read", "View items"],
  ["item.manage", "Create and update items"],
  ["warehousemd.read", "View warehouse master data"],
  ["warehousemd.manage", "Manage warehouse master data"],
  ["coa.read", "View chart of accounts"],
  ["coa.manage", "Manage chart of accounts"],
  ["taxcode.read", "View tax codes"],
  ["taxcode.manage", "Manage tax codes"],

  // reports
  ["report.operations", "View operations reports"],
  ["report.fleet", "View fleet reports"],
  ["report.finance", "View financial reports"],
  ["report.compliance", "View compliance reports"],
  ["report.audit", "View audit reports"],

  // administration
  ["company.read", "View companies"],
  ["company.manage", "Create and update companies"],
  ["branch.read", "View branches"],
  ["branch.manage", "Create and update branches"],
  ["user.read", "View users"],
  ["user.manage", "Create, update and deactivate users"],
  ["role.read", "View roles and permissions"],
  ["role.manage", "Create roles and assign permissions"],
  ["settings.read", "View company settings"],
  ["settings.manage", "Manage company settings"],
  ["integration.read", "View integrations"],
  ["integration.manage", "Manage integrations"],
  ["audit.read", "View the audit log"],
  [SYSTEM_ADMIN, "Full platform administration across every company"],

  // driver app (not a web console permission)
  ["driverapp.trip.read", "Driver app: view assigned trips"],
  ["driverapp.trip.update", "Driver app: update trip progress"],
  ["driverapp.tracking.submit", "Driver app: submit tracking points"],
  ["driverapp.pod.submit", "Driver app: submit proof of delivery"],
];

/** Every permission code (Set for O(1) validation). */
export const ALL_PERMISSION_CODES = PERMISSION_CATALOG.map(([code]) => code);
const ALL_SET = new Set(ALL_PERMISSION_CODES);

const READ_LIKE = /(\.|^)(read|available|availability)/;
const NON_WEB = (code) => code.startsWith("driverapp.");

/** Every read-oriented web permission — the Auditor's grant. */
const AUDITOR_PERMS = ALL_PERMISSION_CODES.filter(
  (c) => !NON_WEB(c) && c !== SYSTEM_ADMIN && (READ_LIKE.test(c) || c.startsWith("report."))
).concat("audit.read");

/* ------------------------------------------------------------------ */
/* Role templates                                                      */
/* ------------------------------------------------------------------ */

export const ROLE_TEMPLATES = [
  {
    key: "system_administrator",
    name: "System Administrator",
    scope: "system",
    description:
      "Manages the entire installation, companies, global configuration, and system-level administration.",
    permissions: [SYSTEM_ADMIN, ...ALL_PERMISSION_CODES.filter((c) => !NON_WEB(c))],
  },
  {
    key: "company_administrator",
    name: "Company Administrator",
    scope: "company",
    description:
      "Manages users, roles, branches, and settings only inside an assigned company.",
    permissions: ALL_PERMISSION_CODES.filter((c) => !NON_WEB(c) && c !== SYSTEM_ADMIN),
  },
  {
    key: "branch_manager",
    name: "Branch Manager",
    scope: "branch",
    description:
      "Oversees branch operations, approves trips, monitors dispatch, fleet, warehouse activity, and reports for assigned branches.",
    permissions: [
      "trip.read", "trip.validate", "trip.approve", "trip.reject", "trip.assign",
      "trip.release", "trip.cancel", "trip.close",
      "tracking.read", "exception.read", "exception.resolve",
      "vehicle.read", "driver.read", "maintenance.read", "fleet.availability.read", "compliance.read",
      "warehouse.read", "inventory.read", "stockmovement.read", "transfer.read",
      "expense.read", "voucher.read",
      "customer.read", "supplier.read", "item.read",
      "report.operations", "report.fleet", "report.finance", "report.compliance",
      "branch.read", "user.read", "audit.read",
    ],
  },
  {
    key: "dispatcher",
    name: "Dispatcher / Operations Coordinator",
    scope: "branch",
    description:
      "Creates and submits trips, assigns drivers and vehicles, releases trips, monitors tracking, and manages operational exceptions.",
    permissions: [
      "trip.read", "trip.create", "trip.update", "trip.submit", "trip.assign", "trip.release",
      "tracking.read", "tracking.update",
      "exception.read", "exception.create", "exception.resolve",
      "vehicle.read", "driver.read", "fleet.availability.read",
      "warehouse.read",
      "customer.read",
      "report.operations",
    ],
  },
  {
    key: "trip_approver",
    name: "Trip Approver",
    scope: "company",
    description:
      "Reviews, approves, or rejects submitted trips but cannot administer users or system settings.",
    permissions: [
      "trip.read", "trip.validate", "trip.approve", "trip.reject",
      "tracking.read", "exception.read",
      "customer.read", "report.operations", "audit.read",
    ],
  },
  {
    key: "fleet_manager",
    name: "Fleet Manager",
    scope: "company",
    description: "Manages vehicles, drivers, maintenance, availability, and compliance.",
    permissions: [
      "trip.read", "tracking.read",
      "vehicle.read", "vehicle.manage", "driver.read", "driver.manage",
      "maintenance.read", "maintenance.manage", "fleet.availability.read",
      "compliance.read", "compliance.manage",
      "report.fleet", "report.compliance",
    ],
  },
  {
    key: "warehouse_officer",
    name: "Warehouse Officer",
    scope: "branch",
    description:
      "Manages cargo release, cargo return, inventory, stock movements, and branch transfers.",
    permissions: [
      "trip.read",
      "warehouse.read", "cargo.release", "cargo.return",
      "inventory.read", "inventory.manage",
      "stockmovement.read", "stockmovement.manage",
      "transfer.read", "transfer.manage",
      "item.read", "warehousemd.read",
      "report.operations",
    ],
  },
  {
    key: "finance_officer",
    name: "Finance Officer",
    scope: "company",
    description:
      "Manages trip expenses, vouchers, invoices, journal entries, and finance reports.",
    permissions: [
      "trip.read",
      "expense.read", "expense.manage",
      "voucher.read", "voucher.manage", "voucher.approve",
      "invoice.read", "invoice.manage",
      "journal.read", "journal.manage",
      "bir.read", "bir.manage",
      "customer.read", "supplier.read",
      "coa.read", "coa.manage", "taxcode.read", "taxcode.manage",
      "report.finance", "report.operations", "audit.read",
    ],
  },
  {
    key: "auditor",
    name: "Auditor / Read-Only User",
    scope: "company",
    description:
      "Can view authorized operational data, reports, and audit logs but cannot create, edit, approve, or delete records.",
    permissions: [...new Set(AUDITOR_PERMS)],
  },
  {
    key: "driver",
    name: "Driver",
    scope: "driver",
    description:
      "Can only see assigned trips, update trip progress, submit tracking/status information, and provide delivery confirmation.",
    permissions: [
      "driverapp.trip.read", "driverapp.trip.update",
      "driverapp.tracking.submit", "driverapp.pod.submit",
    ],
  },
];

export const TEMPLATE_NAMES = ROLE_TEMPLATES.map((t) => t.name);

/* ------------------------------------------------------------------ */
/* Pure helpers (no DB — unit tested)                                  */
/* ------------------------------------------------------------------ */

/** True when the permission code exists in the catalog. */
export function isKnownPermission(code) {
  return ALL_SET.has(code);
}

/**
 * Collapse a set of granted codes into an "effective" set.
 * If SYSTEM_ADMIN is present, the effective set is every web permission.
 */
export function effectivePermissions(grantedCodes) {
  const set = new Set(grantedCodes);
  if (set.has(SYSTEM_ADMIN)) {
    return new Set(ALL_PERMISSION_CODES.filter((c) => !NON_WEB(c)));
  }
  return set;
}

/** Does this granted set satisfy `code`? SYSTEM_ADMIN satisfies everything. */
export function can(grantedCodes, code) {
  const set = grantedCodes instanceof Set ? grantedCodes : new Set(grantedCodes);
  return set.has(SYSTEM_ADMIN) || set.has(code);
}

/** Does this granted set satisfy at least one of `codes`? */
export function canAny(grantedCodes, codes) {
  const set = grantedCodes instanceof Set ? grantedCodes : new Set(grantedCodes);
  if (set.has(SYSTEM_ADMIN)) return true;
  return codes.some((c) => set.has(c));
}

/**
 * Guard on *granting*: an actor may only grant permissions they themselves
 * hold. SYSTEM_ADMIN is additionally ungrantable unless the actor holds it.
 * Returns the list of codes the actor is NOT allowed to grant ([] = ok).
 */
export function ungrantable(actorGrantedCodes, requestedCodes) {
  const actor = actorGrantedCodes instanceof Set ? actorGrantedCodes : new Set(actorGrantedCodes);
  if (actor.has(SYSTEM_ADMIN)) return [];
  return requestedCodes.filter((c) => c === SYSTEM_ADMIN || !actor.has(c));
}

/** Resolve a template's permission list against the live catalog (drops unknowns). */
export function templatePermissions(templateName) {
  const t = ROLE_TEMPLATES.find((x) => x.name === templateName || x.key === templateName);
  if (!t) return [];
  return t.permissions.filter((c) => ALL_SET.has(c));
}
