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
  const list = Array.isArray(codes) ? codes : [codes];
  const wanted = [...new Set([...list, SYSTEM_ADMIN])];
  const placeholders = wanted.map(() => "?").join(", ");

  const [rows] = await runner.query(
    `SELECT 1
     FROM user_roles ur
     JOIN role_permissions rp ON rp.role_id = ur.role_id
     JOIN permissions p ON p.permission_id = rp.permission_id
     WHERE ur.user_id = ?
       AND ur.company_id = ?
       AND ur.status = 'active'
       AND (ur.branch_id = ? OR ur.branch_id IS NULL)
       AND p.permission_code IN (${placeholders})
     LIMIT 1`,
    [userId, companyId, branchId ?? null, ...wanted]
  );

  return rows.length > 0;
}
