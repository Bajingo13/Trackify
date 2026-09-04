/**
 * "Company administrator" is defined by capability, not role name: an active
 * user who — through any active role in that company — holds BOTH `user.manage`
 * and `role.manage`. This survives template renames and custom admin roles.
 *
 * `runner` is a pool or connection with `.query`.
 */

const ADMIN_PERMS = ["user.manage", "role.manage"];
const SYSTEM_ADMIN = "system.admin";

function hasAdminCapability(codes) {
  return codes.has(SYSTEM_ADMIN) || ADMIN_PERMS.every((code) => codes.has(code));
}

/** Set of user_ids that are effective administrators of the company. */
export async function companyAdminUserIds(runner, companyId) {
  const [rows] = await runner.query(
    `SELECT ur.user_id, p.permission_code
     FROM user_roles ur
     JOIN users u ON u.user_id = ur.user_id AND u.status = 'active'
     JOIN roles r ON r.role_id = ur.role_id AND r.status = 'active'
     JOIN role_permissions rp ON rp.role_id = ur.role_id
     JOIN permissions p ON p.permission_id = rp.permission_id
     WHERE ur.company_id = ? AND ur.status = 'active'
       AND p.permission_code IN (?, ?, ?)`,
    [companyId, ...ADMIN_PERMS, SYSTEM_ADMIN]
  );
  const byUser = new Map();
  for (const row of rows) {
    if (!byUser.has(row.user_id)) byUser.set(row.user_id, new Set());
    byUser.get(row.user_id).add(row.permission_code);
  }
  return new Set(
    [...byUser.entries()].filter(([, codes]) => hasAdminCapability(codes)).map(([userId]) => userId)
  );
}

/** Would holding this set of roles make someone a company administrator? */
export async function rolesConferAdmin(runner, roleIds) {
  if (!roleIds.length) return false;
  const ph = roleIds.map(() => "?").join(", ");
  const [rows] = await runner.query(
    `SELECT DISTINCT p.permission_code
     FROM roles r
     JOIN role_permissions rp ON rp.role_id = r.role_id
     JOIN permissions p ON p.permission_id = rp.permission_id
     WHERE r.role_id IN (${ph}) AND r.status = 'active'
       AND p.permission_code IN (?, ?, ?)`,
    [...roleIds, ...ADMIN_PERMS, SYSTEM_ADMIN]
  );
  return hasAdminCapability(new Set(rows.map((row) => row.permission_code)));
}

/**
 * Branch scopes to retain when replacing a user's company roles. Existing
 * active role scopes are authoritative; company-access scopes are the fallback
 * for users who do not yet have a role assignment.
 */
export async function userRoleAssignmentScopes(runner, userId, companyId) {
  const [roleRows] = await runner.query(
    `SELECT DISTINCT branch_id
     FROM user_roles
     WHERE user_id = ? AND company_id = ? AND status = 'active'`,
    [userId, companyId]
  );
  const rows = roleRows.length
    ? roleRows
    : (
        await runner.query(
          `SELECT DISTINCT branch_id
           FROM user_company_access
           WHERE user_id = ? AND company_id = ? AND status = 'active'
             AND (effective_from IS NULL OR effective_from <= CURRENT_DATE)
             AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)`,
          [userId, companyId]
        )
      )[0];

  return [...new Set(rows.map((row) => (row.branch_id == null ? null : Number(row.branch_id))))];
}

/**
 * Effective administrators after replacing one role's permission set. This is
 * calculated inside the caller's transaction before any destructive write.
 */
export async function companyAdminUserIdsAfterRolePermissionChange(
  runner,
  companyId,
  roleId,
  replacementPermissionIds
) {
  const [existingRows] = await runner.query(
    `SELECT ur.user_id, p.permission_code
     FROM user_roles ur
     JOIN users u ON u.user_id = ur.user_id AND u.status = 'active'
     JOIN roles r ON r.role_id = ur.role_id AND r.status = 'active'
     JOIN role_permissions rp ON rp.role_id = ur.role_id
     JOIN permissions p ON p.permission_id = rp.permission_id
     WHERE ur.company_id = ? AND ur.status = 'active' AND ur.role_id <> ?
       AND p.permission_code IN (?, ?, ?)`,
    [companyId, roleId, ...ADMIN_PERMS, SYSTEM_ADMIN]
  );
  const [targetUsers] = await runner.query(
    `SELECT DISTINCT ur.user_id
     FROM user_roles ur
     JOIN users u ON u.user_id = ur.user_id AND u.status = 'active'
     JOIN roles r ON r.role_id = ur.role_id AND r.status = 'active'
     WHERE ur.company_id = ? AND ur.role_id = ? AND ur.status = 'active'`,
    [companyId, roleId]
  );

  let replacementCodes = [];
  if (replacementPermissionIds.length) {
    const ph = replacementPermissionIds.map(() => "?").join(", ");
    const [permissionRows] = await runner.query(
      `SELECT permission_code FROM permissions
       WHERE permission_id IN (${ph}) AND permission_code IN (?, ?, ?)`,
      [...replacementPermissionIds, ...ADMIN_PERMS, SYSTEM_ADMIN]
    );
    replacementCodes = permissionRows.map((row) => row.permission_code);
  }

  const byUser = new Map();
  for (const row of existingRows) {
    if (!byUser.has(row.user_id)) byUser.set(row.user_id, new Set());
    byUser.get(row.user_id).add(row.permission_code);
  }
  for (const row of targetUsers) {
    if (!byUser.has(row.user_id)) byUser.set(row.user_id, new Set());
    for (const code of replacementCodes) byUser.get(row.user_id).add(code);
  }

  return new Set(
    [...byUser.entries()].filter(([, codes]) => hasAdminCapability(codes)).map(([userId]) => userId)
  );
}
