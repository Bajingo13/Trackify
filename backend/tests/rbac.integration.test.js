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
import { hasPermissionInScope, isSystemAdministrator } from "../src/shared/accessCheck.js";
import { syncPermissionCatalog, provisionCompanyRoles } from "../src/shared/provisionRoles.js";
import appDb from "../src/config/db.js";
import { loadGrantedCodes, loadAuthProfile } from "../src/modules/auth/auth.service.js";
import {
  companyAdminUserIdsAfterRolePermissionChange,
  userRoleAssignmentScopes,
} from "../src/shared/companyAdmins.js";

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

  // two isolated scratch companies and branch scopes in each
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
  const [brB] = await db.query(
    "INSERT INTO branches (company_id, branch_name, branch_code, status) VALUES (?, ?, ?, 'active')",
    [companyB, `${TAG} bB`, `${TAG.slice(0, 4)}B${Date.now() % 10000}`]
  );
  const branchB = brB.insertId;

  const hash = await bcrypt.hash("test-password-123", 4);
  const [u] = await db.query(
    "INSERT INTO users (email, password_hash, first_name, last_name, status) VALUES (?, ?, 'RBAC', 'Tester', 'active')",
    [`${TAG}${Date.now()}@example.test`, hash]
  );
  const userId = u.insertId;
  const [sys] = await db.query(
    "INSERT INTO users (email, password_hash, first_name, last_name, status) VALUES (?, ?, 'System', 'Tester', 'active')",
    [`${TAG}sys${Date.now()}@example.test`, hash]
  );
  const systemUserId = sys.insertId;

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

  const systemAdminA = await roleId(companyA, "System Administrator");
  await db.query(
    "INSERT INTO user_company_access (user_id, company_id, branch_id, status) VALUES (?, ?, ?, 'active')",
    [systemUserId, companyA, branch1]
  );
  await db.query(
    "INSERT INTO user_roles (user_id, role_id, company_id, branch_id, status) VALUES (?, ?, ?, ?, 'active')",
    [systemUserId, systemAdminA, companyA, branch1]
  );

  ctx = { companyA, companyB, branch1, branch2, branchB, userId, systemUserId, dispatcherA, systemAdminA };
});

after(async () => {
  /*
   * loadAuthProfile runs on the application's own connection pool, not on this
   * file's connection, and an open pool keeps the process alive after the last
   * test has passed. That is a hang rather than a failure — the least useful
   * way for a run to go wrong, because it reports nothing at all.
   */
  await appDb.end().catch(() => {});

  if (!db || !ctx) {
    if (db) await db.end();
    return;
  }
  const { companyA, companyB, userId, systemUserId } = ctx;
  for (const id of [userId, systemUserId]) {
    await db.query("DELETE FROM user_roles WHERE user_id = ?", [id]);
    await db.query("DELETE FROM user_company_access WHERE user_id = ?", [id]);
    await db.query("DELETE FROM users WHERE user_id = ?", [id]);
  }
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

test("system administrator permission applies globally across companies and branches", async (t) => {
  if (!db) return t.skip("no database");
  const { systemUserId, companyB, branchB } = ctx;
  assert.equal(await isSystemAdministrator(db, systemUserId), true);
  assert.equal(
    await hasPermissionInScope(
      db,
      { userId: systemUserId, companyId: companyB, branchId: branchB },
      "trip.read"
    ),
    true
  );
  assert.equal((await loadGrantedCodes(systemUserId, companyB, branchB, db)).includes("system.admin"), true);
});

test("every operating scope offered is one the API will actually accept", async (t) => {
  if (!db) return t.skip("no database");
  /*
   * The access list used to lead with a company-wide row carrying no branch.
   * The switcher offered it as "All branches" and every /api/v1 route answered
   * it with a 400, because a request has to name one branch — so the most
   * prominent option on the screen was the one that could not work, and login
   * carried a workaround to avoid landing on it.
   *
   * A company-wide grant means "any branch of this company", not "no branch",
   * so it is expanded into those branches. Offering a scope that cannot be used
   * is worse than offering fewer: the person picks it, and the system breaks in
   * a way that looks like their fault.
   */
  const { systemUserId } = ctx;
  const profile = await loadAuthProfile(systemUserId);

  assert.ok(profile.access.length > 0, "a system administrator was offered nowhere to work");
  assert.deepEqual(
    profile.access.filter((a) => a.branch_id == null),
    [],
    "an access row with no branch was offered, and every route rejects it"
  );
  // Which branch the data belongs to has to be legible, not inferred.
  assert.ok(profile.access.every((a) => a.branch_name), "a scope was offered with no branch name to show");
});

test("role replacement retains the user's existing branch scope", async (t) => {
  if (!db) return t.skip("no database");
  const { userId, companyA, branch1 } = ctx;
  assert.deepEqual(await userRoleAssignmentScopes(db, userId, companyA), [branch1]);
});

test("projected role permissions detect removal of the last administrator", async (t) => {
  if (!db) return t.skip("no database");
  const { companyA, systemAdminA, systemUserId } = ctx;
  const withoutAdminPermissions = await companyAdminUserIdsAfterRolePermissionChange(
    db,
    companyA,
    systemAdminA,
    []
  );
  assert.equal(withoutAdminPermissions.size, 0);

  const [permissionRows] = await db.query(
    "SELECT permission_id FROM permissions WHERE permission_code = 'system.admin' LIMIT 1"
  );
  const retainingAdmin = await companyAdminUserIdsAfterRolePermissionChange(
    db,
    companyA,
    systemAdminA,
    [permissionRows[0].permission_id]
  );
  assert.deepEqual([...retainingAdmin], [systemUserId]);
});

test("inactive roles no longer grant permissions", async (t) => {
  if (!db) return t.skip("no database");
  const { userId, companyA, branch1, dispatcherA } = ctx;
  await db.query("UPDATE roles SET status = 'inactive' WHERE role_id = ?", [dispatcherA]);
  try {
    assert.equal(
      await hasPermissionInScope(db, { userId, companyId: companyA, branchId: branch1 }, "trip.read"),
      false
    );
    assert.equal((await loadGrantedCodes(userId, companyA, branch1, db)).includes("trip.read"), false);
  } finally {
    await db.query("UPDATE roles SET status = 'active' WHERE role_id = ?", [dispatcherA]);
  }
});
