/**
 * 005 — RBAC foundation
 *
 * - adds roles.is_system + roles.description
 * - writes the full permission catalogue
 * - seeds the 10 system-role templates (+ their permissions) into every company
 * - promotes any holder of the legacy "Admin" role to "System Administrator"
 *
 * Idempotent. Does not touch or drop anything from earlier migrations.
 */
import { provisionAllCompanies } from "../src/shared/provisionRoles.js";

export async function up(conn) {
  const [cols] = await conn.query("SHOW COLUMNS FROM roles");
  const have = new Set(cols.map((c) => c.Field));

  if (!have.has("is_system")) {
    await conn.query(
      "ALTER TABLE roles ADD COLUMN is_system TINYINT(1) NOT NULL DEFAULT 0 AFTER role_name"
    );
  }
  if (!have.has("description")) {
    await conn.query(
      "ALTER TABLE roles ADD COLUMN description VARCHAR(255) NULL AFTER is_system"
    );
  }

  await provisionAllCompanies(conn);

  // Carry the existing installation forward: whoever was "Admin" is now a
  // System Administrator (the legacy role is left in place as a custom role).
  await conn.query(`
    INSERT INTO user_roles (user_id, role_id, company_id, branch_id, status)
    SELECT DISTINCT ur.user_id, sysrole.role_id, ur.company_id, ur.branch_id, 'active'
    FROM user_roles ur
    JOIN roles legacy   ON legacy.role_id = ur.role_id AND legacy.role_name = 'Admin'
    JOIN roles sysrole  ON sysrole.company_id = ur.company_id
                       AND sysrole.role_name = 'System Administrator'
    WHERE ur.status = 'active'
    ON DUPLICATE KEY UPDATE status = 'active'
  `);
}
