import "../src/config/env.js";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import db from "../src/config/db.js";
import { createClient } from "../src/modules/admin/clientOnboarding.controller.js";
import { deleteUser } from "../src/modules/admin/users.controller.js";
import { __setInvitationMail } from "../src/shared/invitations.js";

// Pinned, so these tests mean the same thing on a server that has SMTP set.
__setInvitationMail({ isMailConfigured: () => false, send: async () => ({ sent: false }) });

after(async () => {
  __setInvitationMail();
  await db.end();
});

function response() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    set(name, value) { this.headers[name] = value; return this; },
    json(body) { this.body = body; return this; },
  };
}

const SYSTEM = { context: { isSystemAdmin: true, userId: null, companyId: null, branchId: null }, user: { userId: null, email: "system@example.test" }, headers: {}, socket: {} };

/* A fresh tenant whose only user is an invited administrator. */
async function tenant(tag) {
  const suffix = `${tag}${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const res = response();
  await createClient({
    ...SYSTEM,
    body: {
      companyName: `QA Delete ${suffix}`, companyCode: `QD${suffix}`.slice(0, 30),
      branchName: "Main Branch", branchCode: "MAIN", firstName: "Del", lastName: "Test",
      email: `delete-${suffix}@example.test`,
    },
  }, res);
  assert.equal(res.statusCode, 201);
  return { companyId: res.body.data.company.companyId, userId: res.body.data.administrator.userId };
}

async function cleanUp({ companyId, userId }) {
  await db.execute("DELETE FROM audit_logs WHERE company_id = ? OR (entity_type = 'company' AND entity_id = ?) OR (entity_type = 'user' AND entity_id = ?)", [companyId, String(companyId), String(userId)]);
  await db.execute("UPDATE companies SET suspended_by = NULL WHERE company_id = ?", [companyId]);
  await db.execute("DELETE FROM user_roles WHERE user_id = ?", [userId]);
  await db.execute("DELETE FROM user_company_access WHERE user_id = ?", [userId]);
  await db.execute("DELETE FROM users WHERE user_id = ?", [userId]);
  await db.execute("DELETE FROM branches WHERE company_id = ?", [companyId]);
  await db.execute("DELETE rp FROM role_permissions rp JOIN roles r ON r.role_id = rp.role_id WHERE r.company_id = ?", [companyId]);
  await db.execute("DELETE FROM roles WHERE company_id = ?", [companyId]);
  await db.execute("DELETE FROM companies WHERE company_id = ?", [companyId]);
}

const asAdmin = (companyId, id, actor = 999999) => ({
  params: { id }, context: { companyId, userId: actor }, user: { userId: actor, email: "admin@example.test" }, headers: {}, socket: {},
});

test("an invitation nobody accepted can be deleted for good, with its links", async () => {
  const ids = await tenant("a");
  try {
    const res = response();
    await deleteUser(asAdmin(ids.companyId, ids.userId), res);
    assert.equal(res.statusCode, 200);

    const [[gone]] = await db.execute("SELECT COUNT(*) AS n FROM users WHERE user_id = ?", [ids.userId]);
    assert.equal(Number(gone.n), 0);
    const [[links]] = await db.execute("SELECT COUNT(*) AS n FROM user_invitations WHERE user_id = ?", [ids.userId]);
    assert.equal(Number(links.n), 0);
    const [[audit]] = await db.execute(
      "SELECT summary FROM audit_logs WHERE action = 'user.delete' AND entity_id = ? ORDER BY audit_id DESC LIMIT 1",
      [String(ids.userId)]
    );
    assert.match(audit.summary, /Permanently deleted the invitation for delete-/);
  } finally {
    await cleanUp(ids);
  }
});

test("an account with history is kept for the record", async () => {
  const ids = await tenant("b");
  try {
    await db.execute("UPDATE companies SET suspended_by = ? WHERE company_id = ?", [ids.userId, ids.companyId]);
    const res = response();
    await deleteUser(asAdmin(ids.companyId, ids.userId), res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, "USER_HAS_HISTORY");
    const [[kept]] = await db.execute("SELECT COUNT(*) AS n FROM users WHERE user_id = ?", [ids.userId]);
    assert.equal(Number(kept.n), 1);
  } finally {
    await cleanUp(ids);
  }
});

test("an active account must be deactivated first, and nobody deletes themselves", async () => {
  const ids = await tenant("c");
  try {
    await db.execute("UPDATE users SET status = 'active' WHERE user_id = ?", [ids.userId]);
    const active = response();
    await deleteUser(asAdmin(ids.companyId, ids.userId), active);
    assert.equal(active.statusCode, 409);
    assert.match(active.body.message, /Deactivate this user first/);

    const self = response();
    await deleteUser(asAdmin(ids.companyId, ids.userId, ids.userId), self);
    assert.equal(self.statusCode, 409);
    assert.match(self.body.message, /your own account/);
  } finally {
    await cleanUp(ids);
  }
});

test("a user outside the acting company is not found", async () => {
  const ids = await tenant("d");
  try {
    const res = response();
    await deleteUser(asAdmin(ids.companyId + 100000, ids.userId), res);
    assert.equal(res.statusCode, 404);
  } finally {
    await cleanUp(ids);
  }
});
