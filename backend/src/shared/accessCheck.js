import { SYSTEM_ADMIN } from "./rbac.js";

/**
 * Core authorization query, shared by the route guard and the tests.
 *
 * True when `userId` holds ANY of `codes` (or SYSTEM_ADMIN) through an active
 * role assignment valid in company `companyId` and branch `branchId`
 * (branch-null assignments apply to every branch).
 *
 * `runner` is a pool or connection with `.query`.
 */
export async function hasPermissionInScope(runner, { userId, companyId, branchId }, codes) {
  const list = [...new Set((Array.isArray(codes) ? codes : [codes]).filter(Boolean))];
  if (!list.length) return isSystemAdministrator(runner, userId);
  const placeholders = list.map(() => "?").join(", ");

  const [rows] = await runner.query(
    `SELECT 1
     FROM user_roles ur
     JOIN roles r ON r.role_id = ur.role_id AND r.status = 'active'
     JOIN role_permissions rp ON rp.role_id = ur.role_id
     JOIN permissions p ON p.permission_id = rp.permission_id
     WHERE ur.user_id = ?
       AND ur.status = 'active'
       AND (
         p.permission_code = ?
         OR (
           ur.company_id = ?
           AND (ur.branch_id = ? OR ur.branch_id IS NULL)
           AND p.permission_code IN (${placeholders})
         )
       )
     LIMIT 1`,
    [userId, SYSTEM_ADMIN, companyId, branchId ?? null, ...list]
  );

  return rows.length > 0;
}

/** True when the user holds the platform-wide System Administrator grant. */
export async function isSystemAdministrator(runner, userId) {
  const [rows] = await runner.query(
    `SELECT 1
     FROM user_roles ur
     JOIN roles r ON r.role_id = ur.role_id AND r.status = 'active'
     JOIN role_permissions rp ON rp.role_id = ur.role_id
     JOIN permissions p ON p.permission_id = rp.permission_id
     WHERE ur.user_id = ? AND ur.status = 'active'
       AND p.permission_code = ?
     LIMIT 1`,
    [userId, SYSTEM_ADMIN]
  );
  return rows.length > 0;
}
