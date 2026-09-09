/**
 * Pure helpers for the Permissions modal. No React, no I/O — easy to reason
 * about and to unit test.
 *
 * A "permission" is `{ permission_id, permission_code, description }`, matching
 * `GET /admin/permissions`. Groups are the code prefix before the first dot
 * (`branch.read` -> `branch`).
 */

/** Nicely cased group titles; anything not listed is Title-cased from the key. */
const GROUP_LABEL_OVERRIDES = {
  bir: "BIR / EIS",
  eis: "EIS",
  coa: "Chart of Accounts",
  rbac: "Roles & Permissions",
  gps: "GPS",
  api: "API",
  sms: "SMS",
  driverapp: "Driver App",
  pod: "Proof of Delivery",
  fleet: "Fleet",
  taxcode: "Tax Codes",
  warehousemd: "Warehouse (Master Data)",
  stockmovement: "Stock Movements",
};

export function groupLabel(key) {
  if (GROUP_LABEL_OVERRIDES[key]) return GROUP_LABEL_OVERRIDES[key];
  return key
    .split(/[_-]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** `[{group, key, permissions}]` sorted by label, permissions sorted by code. */
export function groupPermissions(perms) {
  const byKey = new Map();
  for (const p of perms) {
    const key = p.permission_code.split(".")[0];
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(p);
  }
  return [...byKey.entries()]
    .map(([key, list]) => ({
      key,
      group: groupLabel(key),
      permissions: [...list].sort((a, b) => a.permission_code.localeCompare(b.permission_code)),
    }))
    .sort((a, b) => a.group.localeCompare(b.group));
}

/**
 * Highly privileged permissions. Granting one of these lets a role change who
 * else can do what, or reaches across companies — worth a heads-up before save.
 * Not "dangerous", just consequential: styled as a subtle warning, never an alarm.
 */
export const SENSITIVE_CODES = new Set([
  "system.admin",
  "user.manage",
  "role.manage",
  "settings.manage",
  "company.manage",
  "branch.manage",
  "integration.manage",
]);

/**
 * Client-side dependency map: an action permission (`x.manage`, `x.approve`, …)
 * needs the group's read permission (`x.read`) to be meaningful. The backend has
 * no dependency model, so this only stops the UI producing an obviously broken
 * set — it never invents a grant the user didn't ask for beyond the implied read.
 *
 * Returns `Map<permission_id, permission_id[]>` (a code -> the ids it requires).
 */
export function buildDeps(catalog) {
  const idByCode = new Map(catalog.map((p) => [p.permission_code, p.permission_id]));
  const deps = new Map();
  for (const p of catalog) {
    const [prefix, action] = p.permission_code.split(".");
    if (!action || action === "read") continue;
    const readId = idByCode.get(`${prefix}.read`);
    if (readId && readId !== p.permission_id) deps.set(p.permission_id, [readId]);
  }
  return deps;
}

/** initial/current are Sets of permission_id. */
export function diffPermissions(initial, current) {
  const added = [];
  const removed = [];
  for (const id of current) if (!initial.has(id)) added.push(id);
  for (const id of initial) if (!current.has(id)) removed.push(id);
  return { added, removed };
}

/** Does a permission match a free-text query (code / description / group)? */
export function permissionMatches(perm, groupLabelText, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    perm.permission_code.toLowerCase().includes(q) ||
    (perm.description || "").toLowerCase().includes(q) ||
    groupLabelText.toLowerCase().includes(q)
  );
}
