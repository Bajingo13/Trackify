import db from "../../config/db.js";
import { effectivePermissions, SYSTEM_ADMIN } from "../../shared/rbac.js";

/**
 * The raw permission codes a user is granted within a company + branch scope
 * (no wildcard expansion). Used by the grant guards in the admin controllers.
 */
export async function loadGrantedCodes(userId, companyId, branchId = null, runner = db) {
  const [rows] = await runner.execute(
     `SELECT DISTINCT p.permission_code
     FROM user_roles ur
     JOIN roles r ON r.role_id = ur.role_id AND r.status = 'active'
     JOIN role_permissions rp ON rp.role_id = ur.role_id
     JOIN permissions p ON p.permission_id = rp.permission_id
     WHERE ur.user_id = ? AND ur.status = 'active'
       AND (
         p.permission_code = ?
         OR (
           (? IS NULL OR ur.company_id = ?)
           AND (ur.branch_id IS NULL OR ? IS NULL OR ur.branch_id = ?)
         )
       )`,
    [userId, SYSTEM_ADMIN, companyId, companyId, branchId, branchId]
  );
  return rows.map((r) => r.permission_code);
}

/**
 * Load a user's full auth profile: identity, company/branch access, active
 * roles, and the effective permission set.
 *
 * Permissions are scoped: when a company (and optionally branch) is supplied,
 * only role assignments valid there count. When no scope is given, the user's
 * first access entry is used as the default — so `login` returns the set the
 * frontend will actually operate with.
 */
export async function loadAuthProfile(userId, scope = {}) {
  const [userRows] = await db.execute(
    `SELECT user_id, email, first_name, last_name, status, created_at
     FROM users WHERE user_id = ? LIMIT 1`,
    [userId]
  );
  if (!userRows.length) return null;
  const user = userRows[0];

  // system.admin means "full platform administration across every company" —
  // gate their operating-context list on the live company/branch tables
  // instead of on granted user_company_access rows, so it never goes stale
  // (a company or branch created after the fact just shows up) and a System
  // Administrator is never left with nowhere to operate because nobody
  // remembered to grant them access to their own installation.
  const [sysAdminRows] = await db.execute(
    `SELECT 1
     FROM user_roles ur
     JOIN roles r ON r.role_id = ur.role_id AND r.status = 'active'
     JOIN role_permissions rp ON rp.role_id = ur.role_id
     JOIN permissions p ON p.permission_id = rp.permission_id
     WHERE ur.user_id = ? AND ur.status = 'active' AND p.permission_code = ?
     LIMIT 1`,
    [userId, SYSTEM_ADMIN]
  );
  const isSystemAdmin = sysAdminRows.length > 0;

  const [access] = isSystemAdmin
    ? await db.execute(
        `SELECT c.company_id, NULL AS branch_id, c.company_name, NULL AS branch_name
         FROM companies c
         WHERE c.status = 'active'
         UNION ALL
         SELECT b.company_id, b.branch_id, c.company_name, b.branch_name
         FROM branches b
         JOIN companies c ON c.company_id = b.company_id
         WHERE b.status = 'active' AND c.status = 'active'
         ORDER BY company_name ASC, branch_name IS NOT NULL ASC, branch_name ASC`
      )
    : await db.execute(
        `SELECT uca.company_id, uca.branch_id, c.company_name, b.branch_name
         FROM user_company_access uca
         JOIN companies c ON c.company_id = uca.company_id
         LEFT JOIN branches b ON b.branch_id = uca.branch_id
         WHERE uca.user_id = ? AND uca.status = 'active'
         ORDER BY uca.company_id, uca.branch_id`,
        [userId]
      );

  const [roles] = await db.execute(
    `SELECT ur.role_id, r.role_name, r.is_system, ur.company_id, ur.branch_id
     FROM user_roles ur
     JOIN roles r ON r.role_id = ur.role_id AND r.status = 'active'
     WHERE ur.user_id = ? AND ur.status = 'active'`,
    [userId]
  );

  const companyId =
    scope.companyId != null ? Number(scope.companyId) : access[0]?.company_id ?? null;
  const branchId =
    scope.branchId != null ? Number(scope.branchId) : access[0]?.branch_id ?? null;

  const [permRows] = await db.execute(
     `SELECT DISTINCT p.permission_code
     FROM user_roles ur
     JOIN roles r ON r.role_id = ur.role_id AND r.status = 'active'
     JOIN role_permissions rp ON rp.role_id = ur.role_id
     JOIN permissions p ON p.permission_id = rp.permission_id
     WHERE ur.user_id = ? AND ur.status = 'active'
       AND (
         p.permission_code = ?
         OR (
           (? IS NULL OR ur.company_id = ?)
           AND (ur.branch_id IS NULL OR ? IS NULL OR ur.branch_id = ?)
         )
       )`,
    [userId, SYSTEM_ADMIN, companyId, companyId, branchId, branchId]
  );

  const permissions = [
    ...effectivePermissions(permRows.map((r) => r.permission_code)),
  ].sort();

  return {
    user: {
      userId: user.user_id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      status: user.status,
      createdAt: user.created_at,
    },
    access,
    roles,
    permissions,
    scope: { companyId, branchId },
  };
}
