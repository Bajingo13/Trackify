import { PERMISSION_CATALOG, ROLE_TEMPLATES } from "./rbac.js";

/**
 * RBAC provisioning — used by migration 005 and by company creation, so the
 * seeded roles come from exactly one definition (src/shared/rbac.js).
 *
 * Every function is additive and idempotent: it never removes a permission an
 * admin added, and it never deletes a role.
 *
 * `runner` is any object with an async `.query(sql, params)` (a pool or a
 * single connection).
 */

/** Upsert the full permission catalog. */
export async function syncPermissionCatalog(runner) {
  const rows = PERMISSION_CATALOG.map(() => "(?, ?)").join(", ");
  await runner.query(
    `INSERT INTO permissions (permission_code, description) VALUES ${rows}
     ON DUPLICATE KEY UPDATE description = VALUES(description)`,
    PERMISSION_CATALOG.flat()
  );
}

/** Seed the system-role templates and their permissions for one company. */
export async function provisionCompanyRoles(runner, companyId) {
  for (const tpl of ROLE_TEMPLATES) {
    await runner.query(
      `INSERT INTO roles (company_id, role_name, is_system, description, status)
       VALUES (?, ?, 1, ?, 'active')
       ON DUPLICATE KEY UPDATE is_system = 1, description = VALUES(description)`,
      [companyId, tpl.name, tpl.description]
    );

    const [roleRows] = await runner.query(
      `SELECT role_id FROM roles WHERE company_id = ? AND role_name = ? LIMIT 1`,
      [companyId, tpl.name]
    );
    const roleId = roleRows[0]?.role_id;
    if (!roleId || !tpl.permissions.length) continue;

    const placeholders = tpl.permissions.map(() => "?").join(", ");
    await runner.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT ?, p.permission_id FROM permissions p
       WHERE p.permission_code IN (${placeholders})
       ON DUPLICATE KEY UPDATE permission_id = role_permissions.permission_id`,
      [roleId, ...tpl.permissions]
    );
  }
}

/** Catalog + every company (migration path). */
export async function provisionAllCompanies(runner) {
  await syncPermissionCatalog(runner);
  const [companies] = await runner.query(`SELECT company_id FROM companies`);
  for (const c of companies) {
    await provisionCompanyRoles(runner, c.company_id);
  }
}
