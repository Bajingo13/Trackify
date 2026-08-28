/**
 * DB-backed RBAC checks: role assignment, permission denial, company isolation,
 * branch isolation. Self-skips when no database is reachable so `npm test`
 * still passes in a bare checkout / CI without MySQL.
 *
 *   npm test            (backend)
 */
import "../src/config/env.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import bcrypt from "bcrypt";
import { hasPermissionInScope } from "../src/shared/accessCheck.js";
import { syncPermissionCatalog, provisionCompanyRoles } from "../src/shared/provisionRoles.js";

const TAG = "__rbac_it__";
let db = null;
let ctx = null;

async function connect() {
  try {
    return await mysql.createConnection({
      host: process.env.DB_HOST || "127.0.0.1",
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD || "",
      database: process.env.DB_NAME || "trackify",
    });
  } catch (e) {
    if (process.env.RBAC_TEST_DEBUG) console.error("[rbac-it] connect failed:", e.code, e.message);
    return null;
  }
}

async function roleId(companyId, name) {
  const [r] = await db.query(
    "SELECT role_id FROM roles WHERE company_id = ? AND role_name = ? LIMIT 1",
    [companyId, name]
  );
  return r[0]?.role_id;
}

before(async () => {
  db = await connect();
  if (!db) return;

  await syncPermissionCatalog(db);

  // two isolated scratch companies, two branches in company A
  const [a] = await db.query(
    "INSERT INTO companies (company_name, company_code, status) VALUES (?, ?, 'active')",
    [`${TAG} A`, `${TAG.slice(0, 6)}A${Date.now() % 100000}`]
  );
  const [b] = await db.query(
    "INSERT INTO companies (company_name, company_code, status) VALUES (?, ?, 'active')",
    [`${TAG} B`, `${TAG.slice(0, 6)}B${Date.now() % 100000}`]
  );
  const companyA = a.insertId;
  const companyB = b.insertId;

  await provisionCompanyRoles(db, companyA);
  await provisionCompanyRoles(db, companyB);

  const [br1] = await db.query(
    "INSERT INTO branches (company_id, branch_name, branch_code, status) VALUES (?, ?, ?, 'active')",
    [companyA, `${TAG} b1`, `${TAG.slice(0, 4)}1${Date.now() % 10000}`]
  );
  const [br2] = await db.query(
    "INSERT INTO branches (company_id, branch_name, branch_code, status) VALUES (?, ?, ?, 'active')",
    [companyA, `${TAG} b2`, `${TAG.slice(0, 4)}2${Date.now() % 10000}`]
  );
  const branch1 = br1.insertId;
  const branch2 = br2.insertId;

  const hash = await bcrypt.hash("test-password-123", 4);
  const [u] = await db.query(
    "INSERT INTO users (email, password_hash, first_name, last_name, status) VALUES (?, ?, 'RBAC', 'Tester', 'active')",
    [`${TAG}${Date.now()}@example.test`, hash]
  );
  const userId = u.insertId;

  // Dispatcher in company A, branch 1 only
  const dispatcherA = await roleId(companyA, "Dispatcher / Operations Coordinator");
  await db.query(
    "INSERT INTO user_company_access (user_id, company_id, branch_id, status) VALUES (?, ?, ?, 'active')",
    [userId, companyA, branch1]
  );
  await db.query(
    "INSERT INTO user_roles (user_id, role_id, company_id, branch_id, status) VALUES (?, ?, ?, ?, 'active')",
    [userId, dispatcherA, companyA, branch1]
  );

  ctx = { companyA, companyB, branch1, branch2, userId };
});

after(async () => {
  if (!db || !ctx) {
    if (db) await db.end();
    return;
  }
  const { companyA, companyB, userId } = ctx;
  await db.query("DELETE FROM user_roles WHERE user_id = ?", [userId]);
  await db.query("DELETE FROM user_company_access WHERE user_id = ?", [userId]);
  await db.query("DELETE FROM users WHERE user_id = ?", [userId]);
  for (const c of [companyA, companyB]) {
    await db.query("DELETE rp FROM role_permissions rp JOIN roles r ON r.role_id = rp.role_id WHERE r.company_id = ?", [c]);
    await db.query("DELETE FROM roles WHERE company_id = ?", [c]);
    await db.query("DELETE FROM branches WHERE company_id = ?", [c]);
    await db.query("DELETE FROM companies WHERE company_id = ?", [c]);
  }
  await db.end();
});

test("role assignment grants the role's permissions", async (t) => {
  if (!db) return t.skip("no database");
  const { userId, companyA, branch1 } = ctx;
  assert.equal(
    await hasPermissionInScope(db, { userId, companyId: companyA, branchId: branch1 }, "trip.read"),
    true
  );
  assert.equal(
    await hasPermissionInScope(db, { userId, companyId: companyA, branchId: branch1 }, "trip.create"),
    true
  );
});

test("permission denial: dispatcher cannot approve trips", async (t) => {
  if (!db) return t.skip("no database");
  const { userId, companyA, branch1 } = ctx;
  assert.equal(
    await hasPermissionInScope(db, { userId, companyId: companyA, branchId: branch1 }, "trip.approve"),
    false
  );
  assert.equal(
    await hasPermissionInScope(db, { userId, companyId: companyA, branchId: branch1 }, "user.manage"),
    false
  );
});

test("company isolation: no permissions in another company", async (t) => {
  if (!db) return t.skip("no database");
  const { userId, companyB, branch1 } = ctx;
  assert.equal(
    await hasPermissionInScope(db, { userId, companyId: companyB, branchId: branch1 }, "trip.read"),
    false
  );
});

test("branch isolation: branch-scoped role does not apply to another branch", async (t) => {
  if (!db) return t.skip("no database");
  const { userId, companyA, branch2 } = ctx;
  assert.equal(
    await hasPermissionInScope(db, { userId, companyId: companyA, branchId: branch2 }, "trip.read"),
    false
  );
});
