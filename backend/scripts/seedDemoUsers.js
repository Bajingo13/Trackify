/**
 * Development demo users — one login per role.
 *
 *   npm run db:seed-demo
 *
 * Creates (or refreshes) a user for EVERY role in the seed company, so you can
 * sign in as a Branch Manager, Dispatcher, Auditor, … and see exactly what that
 * role can do. Custom roles you add later get a demo user too on the next run.
 *
 * All accounts share one password from .env (SEED_DEMO_PASSWORD, default below).
 * Emails follow <role>@gmail.com (short alias for standard roles, dashed name
 * for custom ones) — easy to say out loud in a demo.
 * Idempotent. Local development only — never run against production.
 */
import "../src/config/env.js";
import bcrypt from "bcrypt";
import db from "../src/config/db.js";
import { refuseProductionDatabase } from "../src/shared/productionDatabaseGuard.js";

// Sets every role's account to the published demonstration password. Against
// production that undoes a credential rotation, so it stops before connecting.
refuseProductionDatabase("db:seed-demo");

const COMPANY_CODE = "ABL";
const BRANCH_CODE = "DVO";
const DEMO_DOMAIN = "gmail.com";
const PASSWORD = process.env.SEED_DEMO_PASSWORD || "demo123";

// Short, memorable aliases for the standard role templates — matches what's
// actually handed out for demos. A role not listed here (a client custom role)
// falls back to its dashed name, e.g. "regional-supervisor@gmail.com".
// Older, superseded role templates from before the role set was cleaned up —
// "Admin"/"Dispatcher" are strict subsets of System Administrator / Dispatcher
// Operations Coordinator, and "Approver" is a near-duplicate of Trip Approver.
// Skip them here so their short alias isn't shared with (and merged onto) the
// current role's demo account.
const SKIP_ROLES = new Set(["Admin", "Approver", "Dispatcher"]);

const ALIASES = {
  "System Administrator": "superadmin",
  "Company Administrator": "companyadmin",
  "Branch Manager": "branchmanager",
  "Dispatcher / Operations Coordinator": "dispatcher",
  "Trip Approver": "approver",
  "Fleet Manager": "fleetmanager",
  "Warehouse Officer": "warehouseofficer",
  "Finance Officer": "financeofficer",
  "Auditor / Read-Only User": "auditor",
  "Driver": "driver",
};

const slug = (name) =>
  ALIASES[name] || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

async function main() {
  const [[company]] = await db.query(
    "SELECT company_id FROM companies WHERE company_code = ? LIMIT 1",
    [COMPANY_CODE]
  );
  if (!company) throw new Error(`Company ${COMPANY_CODE} not found — run db:seed-admin first`);
  const companyId = company.company_id;

  const [[branch]] = await db.query(
    "SELECT branch_id FROM branches WHERE company_id = ? AND branch_code = ? LIMIT 1",
    [companyId, BRANCH_CODE]
  );
  const branchId = branch?.branch_id ?? null;

  const [roles] = await db.query(
    `SELECT r.role_id, r.role_name, r.is_system,
            EXISTS(SELECT 1 FROM role_permissions rp
                   JOIN permissions p ON p.permission_id = rp.permission_id
                   WHERE rp.role_id = r.role_id AND p.permission_code LIKE 'driverapp.%') AS is_driver_role
     FROM roles r
     WHERE r.company_id = ? AND r.status = 'active'
     ORDER BY r.is_system DESC, r.role_name`,
    [companyId]
  );

  const hash = await bcrypt.hash(PASSWORD, 10);
  const created = [];

  for (const role of roles) {
    if (SKIP_ROLES.has(role.role_name)) continue;
    const email = `${slug(role.role_name)}@${DEMO_DOMAIN}`;
    // Branch roles are pinned to the demo branch; company/system roles span the company.
    const branchRole = /branch|dispatcher|warehouse/i.test(role.role_name);
    const roleBranchId = branchRole ? branchId : null;

    let [[user]] = await db.query("SELECT user_id FROM users WHERE email = ? LIMIT 1", [email]);
    if (user) {
      await db.query("UPDATE users SET password_hash = ?, status = 'active' WHERE user_id = ?", [
        hash,
        user.user_id,
      ]);
    } else {
      const [res] = await db.query(
        "INSERT INTO users (email, password_hash, first_name, last_name, status) VALUES (?, ?, ?, 'Demo', 'active')",
        [email, hash, role.role_name]
      );
      user = { user_id: res.insertId };
    }
    const userId = user.user_id;

    await db.query(
      `INSERT INTO user_company_access (user_id, company_id, branch_id, status)
       VALUES (?, ?, ?, 'active')
       ON DUPLICATE KEY UPDATE status = 'active'`,
      [userId, companyId, branchId]
    );

    const [[existingRole]] = await db.query(
      "SELECT user_role_id FROM user_roles WHERE user_id = ? AND role_id = ? AND company_id = ? LIMIT 1",
      [userId, role.role_id, companyId]
    );
    if (!existingRole) {
      await db.query(
        "INSERT INTO user_roles (user_id, role_id, company_id, branch_id, status) VALUES (?, ?, ?, ?, 'active')",
        [userId, role.role_id, companyId, roleBranchId]
      );
    }

    created.push({
      role: role.role_name + (role.is_system ? "" : " (custom)"),
      email,
      access: role.is_driver_role ? "driver app only (no web access)" : "web console",
    });
  }

  console.log(`\n  Demo users for ${COMPANY_CODE} / ${BRANCH_CODE} — password for all: ${PASSWORD}\n`);
  const w = Math.max(...created.map((c) => c.role.length));
  for (const c of created) {
    console.log(`  ${c.role.padEnd(w)}   ${c.email.padEnd(38)} ${c.access}`);
  }
  console.log(`\n  ${created.length} demo user(s) ready.\n`);

  await db.end();
}

main().catch(async (error) => {
  console.error(`[seed-demo] Error: ${error.code || error.message}`);
  try { await db.end(); } catch {}
  process.exit(1);
});
