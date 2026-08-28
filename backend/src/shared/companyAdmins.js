/**
 * "Company administrator" is defined by capability, not role name: an active
 * user who — through any active role in that company — holds BOTH `user.manage`
 * and `role.manage`. This survives template renames and custom admin roles.
 *
 * `runner` is a pool or connection with `.query`.
 */

const ADMIN_PERMS = ["user.manage", "role.manage"];

/** Set of user_ids that are effective administrators of the company. */
export async function companyAdminUserIds(runner, companyId) {
  const [rows] = await runner.query(
    `SELECT ur.user_id
     FROM user_roles ur
     JOIN users u ON u.user_id = ur.user_id AND u.status = 'active'
     JOIN role_permissions rp ON rp.role_id = ur.role_id
     JOIN permissions p ON p.permission_id = rp.permission_id
     WHERE ur.company_id = ? AND ur.status = 'active'
       AND p.permission_code IN (?, ?)
     GROUP BY ur.user_id
     HAVING COUNT(DISTINCT p.permission_code) = 2`,
    [companyId, ...ADMIN_PERMS]
  );
  return new Set(rows.map((r) => r.user_id));
}

/** Would holding this set of roles make someone a company administrator? */
export async function rolesConferAdmin(runner, roleIds) {
  if (!roleIds.length) return false;
  const ph = roleIds.map(() => "?").join(", ");
  const [rows] = await runner.query(
    `SELECT r.role_id
     FROM roles r
     JOIN role_permissions rp ON rp.role_id = r.role_id
     JOIN permissions p ON p.permission_id = rp.permission_id
     WHERE r.role_id IN (${ph}) AND p.permission_code IN (?, ?)
     GROUP BY r.role_id
     HAVING COUNT(DISTINCT p.permission_code) = 2
     LIMIT 1`,
    [...roleIds, ...ADMIN_PERMS]
  );
  return rows.length > 0;
}
