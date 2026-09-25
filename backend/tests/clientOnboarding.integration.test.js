import "../src/config/env.js";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import db from "../src/config/db.js";
import { createClient } from "../src/modules/admin/clientOnboarding.controller.js";
import { activateAccount } from "../src/modules/auth/auth.controller.js";
import { issueTemporaryPassword } from "../src/modules/admin/users.controller.js";
import {
  listCompanies,
  reactivateCompany,
  suspendCompany,
} from "../src/modules/admin/companies.controller.js";

after(async () => {
  await db.end();
});

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) { this.statusCode = code; return this; },
    set(name, value) { this.headers[name] = value; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("client setup creates one usable tenant and forces first-login password replacement", async () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const code = `QA${suffix}`.slice(0, 30);
  const email = `client-${suffix}@example.test`;
  const req = {
    body: {
      companyName: `QA Client ${suffix}`,
      companyCode: code,
      branchName: "Main Branch",
      branchCode: "MAIN",
      prefix: "QA",
      firstName: "Client",
      lastName: "Admin",
      email,
    },
    context: { isSystemAdmin: true, userId: null, companyId: null, branchId: null },
    user: { userId: null, email: "system@example.test" },
    headers: {},
    socket: {},
  };
  const res = response();
  let ids;

  try {
    await createClient(req, res);
    assert.equal(res.statusCode, 201);
    assert.equal(res.headers["Cache-Control"], "no-store");
    assert.ok(res.body.data.temporaryPassword);
    ids = {
      companyId: res.body.data.company.companyId,
      branchId: res.body.data.branch.branchId,
      userId: res.body.data.administrator.userId,
    };

    const [[user]] = await db.execute(
      `SELECT password_hash, must_change_password, temporary_password_expires_at
       FROM users WHERE user_id = ?`,
      [ids.userId]
    );
    assert.equal(user.must_change_password, 1);
    assert.ok(new Date(user.temporary_password_expires_at).getTime() > Date.now());
    assert.equal(await bcrypt.compare(res.body.data.temporaryPassword, user.password_hash), true);
    assert.notEqual(user.password_hash, res.body.data.temporaryPassword);

    const [[assignment]] = await db.execute(
      `SELECT r.role_name, ur.branch_id AS role_branch, uca.branch_id AS access_branch
       FROM user_roles ur
       JOIN roles r ON r.role_id = ur.role_id
       JOIN user_company_access uca ON uca.user_id = ur.user_id AND uca.company_id = ur.company_id
       WHERE ur.user_id = ? AND ur.company_id = ?`,
      [ids.userId, ids.companyId]
    );
    assert.equal(assignment.role_name, "Company Administrator");
    assert.equal(assignment.role_branch, null);
    assert.equal(assignment.access_branch, null);

    const companies = response();
    await listCompanies(
      { query: { search: code }, context: { isSystemAdmin: true, userId: null } },
      companies
    );
    assert.equal(companies.body.data.length, 1);
    assert.equal(Number(companies.body.data[0].active_branch_count), 1);
    assert.equal(Number(companies.body.data[0].admin_count), 1);

    const missingReason = response();
    await suspendCompany(
      {
        params: { id: ids.companyId }, body: { reason: "short" },
        context: { isSystemAdmin: true, userId: null, companyId: 0, branchId: null },
      },
      missingReason
    );
    assert.equal(missingReason.statusCode, 400);

    const suspension = response();
    await suspendCompany(
      {
        params: { id: ids.companyId }, body: { reason: "Client requested a temporary access hold." },
        context: { isSystemAdmin: true, userId: null, companyId: 0, branchId: null },
        user: { userId: null, email: "system@example.test" }, headers: {}, socket: {},
      },
      suspension
    );
    assert.equal(suspension.statusCode, 200);
    const [[suspended]] = await db.execute(
      "SELECT status, suspension_reason, suspended_at FROM companies WHERE company_id = ?",
      [ids.companyId]
    );
    assert.equal(suspended.status, "inactive");
    assert.equal(suspended.suspension_reason, "Client requested a temporary access hold.");
    assert.ok(suspended.suspended_at);

    const reactivation = response();
    await reactivateCompany(
      {
        params: { id: ids.companyId },
        context: { isSystemAdmin: true, userId: null, companyId: 0, branchId: null },
        user: { userId: null, email: "system@example.test" }, headers: {}, socket: {},
      },
      reactivation
    );
    assert.equal(reactivation.statusCode, 200);
    const [[reactivated]] = await db.execute(
      "SELECT status, suspension_reason, suspended_at FROM companies WHERE company_id = ?",
      [ids.companyId]
    );
    assert.equal(reactivated.status, "active");
    assert.equal(reactivated.suspension_reason, null);
    assert.equal(reactivated.suspended_at, null);

    const activation = response();
    await activateAccount(
      {
        body: { newPassword: "correct horse battery staple" },
        user: { userId: ids.userId, email, mustChangePassword: true },
        headers: {}, socket: {},
      },
      activation
    );
    assert.equal(activation.statusCode, 200);
    assert.equal(activation.body.data.user.mustChangePassword, false);

    const [[activated]] = await db.execute(
      "SELECT password_hash, must_change_password, temporary_password_expires_at FROM users WHERE user_id = ?",
      [ids.userId]
    );
    assert.equal(activated.must_change_password, 0);
    assert.equal(activated.temporary_password_expires_at, null);
    assert.equal(await bcrypt.compare("correct horse battery staple", activated.password_hash), true);

    const reissue = response();
    await issueTemporaryPassword(
      {
        params: { id: ids.userId },
        context: { companyId: ids.companyId, branchId: ids.branchId, userId: 999999 },
        user: { userId: 999999, email: "system@example.test" },
        headers: {}, socket: {},
      },
      reissue
    );
    assert.equal(reissue.statusCode, 200);
    assert.equal(reissue.headers["Cache-Control"], "no-store");
    assert.ok(reissue.body.data.temporaryPassword);
    const [[reissued]] = await db.execute(
      "SELECT password_hash, must_change_password, temporary_password_expires_at FROM users WHERE user_id = ?",
      [ids.userId]
    );
    assert.equal(reissued.must_change_password, 1);
    assert.equal(await bcrypt.compare(reissue.body.data.temporaryPassword, reissued.password_hash), true);
  } finally {
    if (ids) {
      await db.execute("DELETE FROM audit_logs WHERE company_id = ? OR (entity_type = 'company' AND entity_id = ?)", [ids.companyId, String(ids.companyId)]);
      await db.execute("DELETE FROM user_roles WHERE user_id = ?", [ids.userId]);
      await db.execute("DELETE FROM user_company_access WHERE user_id = ?", [ids.userId]);
      await db.execute("DELETE FROM users WHERE user_id = ?", [ids.userId]);
      await db.execute("DELETE FROM branches WHERE company_id = ?", [ids.companyId]);
      await db.execute("DELETE rp FROM role_permissions rp JOIN roles r ON r.role_id = rp.role_id WHERE r.company_id = ?", [ids.companyId]);
      await db.execute("DELETE FROM roles WHERE company_id = ?", [ids.companyId]);
      await db.execute("DELETE FROM companies WHERE company_id = ?", [ids.companyId]);
    }
  }
});

test("a company administrator cannot create another tenant", async () => {
  const res = response();
  await createClient({ context: { isSystemAdmin: false }, body: {} }, res);
  assert.equal(res.statusCode, 403);
});

test("an administrator cannot use temporary-access recovery on their own session", async () => {
  const res = response();
  await issueTemporaryPassword(
    { params: { id: 42 }, context: { userId: 42, companyId: 1 } },
    res
  );
  assert.equal(res.statusCode, 409);
});
