/**
 * AstreaBlue Trackify — development admin seeder
 *
 *   npm run db:seed-admin
 *
 * Ensures a local login using .env values (SEED_ADMIN_USERNAME / _EMAIL / _PASSWORD):
 *  - ensures the "ABL" company + "DVO" branch
 *  - (re)provisions the system-role templates for that company
 *  - creates/repairs the user and assigns "System Administrator"
 *
 * Never logs the password or hash. Local development only.
 */
import "../src/config/env.js";
import bcrypt from "bcrypt";
import db from "../src/config/db.js";
import { provisionCompanyRoles, syncPermissionCatalog } from "../src/shared/provisionRoles.js";
import { refuseProductionDatabase } from "../src/shared/productionDatabaseGuard.js";

// Resets the administrator's password to a local .env value. Against
// production that is a way back in with a known password, so it stops first.
refuseProductionDatabase("db:seed-admin");

const COMPANY_CODE = "ABL";
const COMPANY_NAME = "AstreaBlue Logistics";
const BRANCH_CODE = "DVO";
const BRANCH_NAME = "Davao Branch";
const ADMIN_ROLE = "System Administrator";

const username = process.env.SEED_ADMIN_USERNAME || "admin";
const email = process.env.SEED_ADMIN_EMAIL;
const password = process.env.SEED_ADMIN_PASSWORD;

if (!email || !password) {
  console.error("[seed-admin] SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set in .env");
  process.exit(1);
}

async function ensureCompany() {
  const [rows] = await db.execute(
    "SELECT company_id FROM companies WHERE company_code = ? LIMIT 1",
    [COMPANY_CODE]
  );
  if (rows.length) return rows[0].company_id;
  const [res] = await db.execute(
    "INSERT INTO companies (company_name, company_code, status) VALUES (?, ?, 'active')",
    [COMPANY_NAME, COMPANY_CODE]
  );
  console.log(`[seed-admin] created company ${COMPANY_CODE}`);
  return res.insertId;
}

async function ensureBranch(companyId) {
  const [rows] = await db.execute(
    "SELECT branch_id FROM branches WHERE company_id = ? AND branch_code = ? LIMIT 1",
    [companyId, BRANCH_CODE]
  );
  if (rows.length) return rows[0].branch_id;
  const [res] = await db.execute(
    "INSERT INTO branches (company_id, branch_name, branch_code, prefix, status) VALUES (?, ?, ?, ?, 'active')",
    [companyId, BRANCH_NAME, BRANCH_CODE, BRANCH_CODE]
  );
  console.log(`[seed-admin] created branch ${BRANCH_CODE}`);
  return res.insertId;
}

async function ensureUser() {
  const hash = await bcrypt.hash(password, 10);
  const [rows] = await db.execute("SELECT user_id FROM users WHERE email = ? LIMIT 1", [email]);
  if (rows.length) {
    await db.execute(
      "UPDATE users SET password_hash = ?, status = 'active' WHERE user_id = ?",
      [hash, rows[0].user_id]
    );
    return { userId: rows[0].user_id, created: false };
  }
  const [res] = await db.execute(
    "INSERT INTO users (email, password_hash, first_name, last_name, status) VALUES (?, ?, ?, ?, 'active')",
    [email, hash, username, "Trackify"]
  );
  return { userId: res.insertId, created: true };
}

async function ensureAccess(userId, companyId, branchId) {
  const [rows] = await db.execute(
    "SELECT access_id FROM user_company_access WHERE user_id = ? AND company_id = ? AND (branch_id = ? OR branch_id IS NULL) LIMIT 1",
    [userId, companyId, branchId]
  );
  if (rows.length) return;
  await db.execute(
    "INSERT INTO user_company_access (user_id, company_id, branch_id, status) VALUES (?, ?, ?, 'active')",
    [userId, companyId, branchId]
  );
}

async function ensureAdminRole(userId, companyId, branchId) {
  const [rows] = await db.execute(
    "SELECT role_id FROM roles WHERE company_id = ? AND role_name = ? LIMIT 1",
    [companyId, ADMIN_ROLE]
  );
  const roleId = rows[0]?.role_id;
  if (!roleId) throw new Error(`${ADMIN_ROLE} role not found — run db:migrate first`);

  const [existing] = await db.execute(
    "SELECT user_role_id FROM user_roles WHERE user_id = ? AND role_id = ? AND company_id = ? LIMIT 1",
    [userId, roleId, companyId]
  );
  if (existing.length) return;
  await db.execute(
    "INSERT INTO user_roles (user_id, role_id, company_id, branch_id, status) VALUES (?, ?, ?, ?, 'active')",
    [userId, roleId, companyId, branchId]
  );
}

async function main() {
  const companyId = await ensureCompany();
  const branchId = await ensureBranch(companyId);

  await syncPermissionCatalog(db);
  await provisionCompanyRoles(db, companyId);

  const { userId, created } = await ensureUser();
  await ensureAccess(userId, companyId, branchId);
  await ensureAdminRole(userId, companyId, branchId);

  console.log(
    created
      ? `[seed-admin] Admin account CREATED: ${email} (user_id ${userId})`
      : `[seed-admin] Admin account already existed — password refreshed: ${email} (user_id ${userId})`
  );
  console.log(`[seed-admin] ${COMPANY_CODE} / ${BRANCH_CODE} / role "${ADMIN_ROLE}"`);
  await db.end();
}

main().catch(async (error) => {
  console.error(`[seed-admin] Error: ${error.code || error.message}`);
  try { await db.end(); } catch {}
  process.exit(1);
});
