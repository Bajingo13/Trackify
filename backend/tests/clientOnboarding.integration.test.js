import "../src/config/env.js";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import db from "../src/config/db.js";
import { createClient } from "../src/modules/admin/clientOnboarding.controller.js";
import { issueTemporaryPassword, resendInvitation } from "../src/modules/admin/users.controller.js";
import { checkInvitation, verifyInvitation, acceptInvitation, MAX_EMAIL_ATTEMPTS } from "../src/modules/auth/invitation.controller.js";
import {
  listCompanies,
  reactivateCompany,
  suspendCompany,
} from "../src/modules/admin/companies.controller.js";

import { __setMail } from "../src/shared/temporaryAccess.js";
import { __setInvitationMail } from "../src/shared/invitations.js";

// Pinned, so these tests mean the same thing on a server that has SMTP set.
const NO_MAIL = { isMailConfigured: () => false, send: async () => ({ sent: false }) };
__setMail(NO_MAIL);
__setInvitationMail(NO_MAIL);

after(async () => {
  __setMail();
  __setInvitationMail();
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

const tokenIn = (url) => new URL(url).searchParams.get("token");
const PASSWORD = "Correct horse battery staple 7!";

async function cleanUp(ids) {
  if (!ids) return;
  await db.execute("DELETE FROM audit_logs WHERE company_id = ? OR (entity_type = 'company' AND entity_id = ?) OR (entity_type = 'user' AND entity_id = ?)", [ids.companyId, String(ids.companyId), String(ids.userId)]);
  await db.execute("DELETE FROM user_roles WHERE user_id = ?", [ids.userId]);
  await db.execute("DELETE FROM user_company_access WHERE user_id = ?", [ids.userId]);
  await db.execute("DELETE FROM users WHERE user_id = ?", [ids.userId]);
  await db.execute("DELETE FROM branches WHERE company_id = ?", [ids.companyId]);
  await db.execute("DELETE rp FROM role_permissions rp JOIN roles r ON r.role_id = rp.role_id WHERE r.company_id = ?", [ids.companyId]);
  await db.execute("DELETE FROM roles WHERE company_id = ?", [ids.companyId]);
  await db.execute("DELETE FROM companies WHERE company_id = ?", [ids.companyId]);
}

function clientRequest(suffix, email, extra = {}) {
  return {
    body: {
      companyName: `QA Client ${suffix}`,
      companyCode: `QA${suffix}`.slice(0, 30),
      branchName: "Main Branch",
      branchCode: "MAIN",
      prefix: "QA",
      firstName: "Client",
      lastName: "Admin",
      email,
      ...extra,
    },
    context: { isSystemAdmin: true, userId: null, companyId: null, branchId: null },
    user: { userId: null, email: "system@example.test" },
    headers: {},
    socket: {},
  };
}

test("client setup invites the administrator, who sets their own password from the link", async () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `client-${suffix}@example.test`;
  const res = response();
  let ids;

  try {
    await createClient(clientRequest(suffix, email, {
      tradeName: "QA Freight", businessType: "Corporation", tin: "123-456-789-000",
      companyEmail: "ops@qa.example", city: "Davao City", paymentTerms: "Net 30",
      branchPhone: "+63 82 123 4567",
    }), res);
    assert.equal(res.statusCode, 201);
    assert.equal(res.headers["Cache-Control"], "no-store");
    // No mail: the admin is handed the link to pass on — never a password.
    assert.equal(res.body.data.delivery, "link");
    assert.ok(res.body.data.inviteUrl);
    assert.equal("temporaryPassword" in res.body.data, false);
    ids = {
      companyId: res.body.data.company.companyId,
      branchId: res.body.data.branch.branchId,
      userId: res.body.data.administrator.userId,
    };
    const token = tokenIn(res.body.data.inviteUrl);

    // The optional profile is kept with the company and its first branch.
    const [[profile]] = await db.execute(
      `SELECT c.trade_name, c.business_type, c.tin, c.email, c.city, c.country, c.payment_terms, b.contact_number
       FROM companies c JOIN branches b ON b.company_id = c.company_id WHERE c.company_id = ?`,
      [ids.companyId]
    );
    assert.deepEqual({ ...profile }, {
      trade_name: "QA Freight", business_type: "Corporation", tin: "123-456-789-000", email: "ops@qa.example",
      city: "Davao City", country: "Philippines", payment_terms: "Net 30", contact_number: "+63 82 123 4567",
    });

    const [[invited]] = await db.execute("SELECT status, must_change_password FROM users WHERE user_id = ?", [ids.userId]);
    assert.equal(invited.status, "invited");
    assert.equal(invited.must_change_password, 0);

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

    // Not an administrator yet: nobody can sign in to the account until they accept.
    const before = response();
    await listCompanies({ query: { search: res.body.data.company.companyCode }, context: { isSystemAdmin: true, userId: null } }, before);
    assert.equal(before.body.data.length, 1);
    assert.equal(Number(before.body.data[0].active_branch_count), 1);
    assert.equal(Number(before.body.data[0].admin_count), 0);

    const missingReason = response();
    await suspendCompany(
      { params: { id: ids.companyId }, body: { reason: "short" }, context: { isSystemAdmin: true, userId: null, companyId: 0, branchId: null } },
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

    // The bare link reveals nothing but a masked address to type in full.
    const check = response();
    await checkInvitation({ query: { token } }, check);
    assert.equal(check.statusCode, 200);
    assert.equal(check.body.data.maskedEmail, `${email[0]}•••@example.test`);
    assert.equal(JSON.stringify(check.body).includes(email), false, "the full address must not be in the response");
    assert.equal(check.body.data.role, undefined);
    assert.equal(check.body.data.companyName, undefined);

    // The typed address (any case, spaces trimmed) unlocks the ticket.
    const verified = response();
    await verifyInvitation({ body: { token, email: `  ${email.toUpperCase()} ` } }, verified);
    assert.equal(verified.statusCode, 200);
    assert.equal(verified.body.data.email, email);
    assert.equal(verified.body.data.role, "Company Administrator");
    assert.equal(verified.body.data.companyName, `QA Client ${suffix}`);

    const bogus = response();
    await checkInvitation({ query: { token: "not-a-real-token" } }, bogus);
    assert.equal(bogus.statusCode, 410);

    const blankName = response();
    await acceptInvitation({ body: { token, newPassword: PASSWORD, firstName: "  ", lastName: "Santos" }, headers: {}, socket: {} }, blankName);
    assert.equal(blankName.statusCode, 400);
    assert.match(blankName.body.message, /first name/);

    const weak = response();
    await acceptInvitation({ body: { token, email, newPassword: "short", firstName: "Maria", lastName: "Santos" }, headers: {}, socket: {} }, weak);
    assert.equal(weak.statusCode, 400);

    const accepted = response();
    await acceptInvitation(
      { body: { token, email, newPassword: PASSWORD, firstName: "  Maria ", lastName: "Santos" }, headers: {}, socket: {} },
      accepted
    );
    assert.equal(accepted.statusCode, 200);
    assert.ok(accepted.body.data.token, "accepting signs them straight in");
    assert.equal(accepted.body.data.user.mustChangePassword, false);

    const [[active]] = await db.execute(
      "SELECT status, password_hash, first_name, last_name FROM users WHERE user_id = ?",
      [ids.userId]
    );
    assert.equal(active.status, "active");
    assert.equal(active.first_name, "Maria");
    assert.equal(active.last_name, "Santos");
    assert.equal(await bcrypt.compare(PASSWORD, active.password_hash), true);

    // Single use.
    const again = response();
    await acceptInvitation({ body: { token, newPassword: PASSWORD, firstName: "Maria", lastName: "Santos" }, headers: {}, socket: {} }, again);
    assert.equal(again.statusCode, 410);
    assert.equal(again.body.code, "INVITATION_USED");

    const afterAccept = response();
    await listCompanies({ query: { search: res.body.data.company.companyCode }, context: { isSystemAdmin: true, userId: null } }, afterAccept);
    assert.equal(Number(afterAccept.body.data[0].admin_count), 1);

    // Once set up, recovery is temporary access / reset, not another invitation.
    const resend = response();
    await resendInvitation({ params: { id: ids.userId }, context: { companyId: ids.companyId, userId: 999999 } }, resend);
    assert.equal(resend.statusCode, 409);

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
    assert.ok(reissue.body.data.temporaryPassword);
  } finally {
    await cleanUp(ids);
  }
});

test("a company administrator cannot create another tenant", async () => {
  const res = response();
  await createClient({ context: { isSystemAdmin: false }, body: {} }, res);
  assert.equal(res.statusCode, 403);
});

test("an administrator cannot use temporary-access recovery on their own session", async () => {
  const res = response();
  await issueTemporaryPassword({ params: { id: 42 }, context: { userId: 42, companyId: 1 } }, res);
  assert.equal(res.statusCode, 409);
});

test("when the server can send email, the invitation goes to the person and a resend kills the old link", async () => {
  const outbox = [];
  __setInvitationMail({ isMailConfigured: () => true, send: async (m) => { outbox.push(m); return { sent: true }; } });

  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `mailed-${suffix}@example.test`;
  const res = response();
  let ids;
  const linkIn = (message) => message.text.match(/https?:\/\/\S+accept-invite\?token=\S+/)?.[0];

  try {
    await createClient(clientRequest(suffix, email, { companyCode: `QM${suffix}`.slice(0, 30) }), res);
    assert.equal(res.statusCode, 201);
    ids = { companyId: res.body.data.company.companyId, userId: res.body.data.administrator.userId };
    assert.equal(res.body.data.delivery, "email");
    assert.equal("inviteUrl" in res.body.data, false, "the link must not be in the response when it was emailed");

    assert.equal(outbox.length, 1);
    assert.equal(outbox[0].to, email);
    assert.match(outbox[0].subject, /invited to Trackify/i);
    assert.match(outbox[0].html, /Company Administrator/);
    const first = tokenIn(linkIn(outbox[0]));
    assert.ok(first);

    const resend = response();
    await resendInvitation(
      {
        params: { id: ids.userId },
        context: { companyId: ids.companyId, userId: null },
        user: { userId: null, email: "system@example.test" }, headers: {}, socket: {},
      },
      resend
    );
    assert.equal(resend.statusCode, 200);
    assert.equal(resend.body.data.delivery, "email");
    assert.equal(outbox.length, 2);
    const second = tokenIn(linkIn(outbox[1]));
    assert.notEqual(second, first);

    const old = response();
    await checkInvitation({ query: { token: first } }, old);
    assert.equal(old.statusCode, 410, "the replaced link stops working");
    const fresh = response();
    await checkInvitation({ query: { token: second } }, fresh);
    assert.equal(fresh.statusCode, 200);

    const [[audit]] = await db.execute(
      "SELECT metadata FROM audit_logs WHERE action = 'user.invite.resend' AND entity_id = ? ORDER BY audit_id DESC LIMIT 1",
      [String(ids.userId)]
    );
    const metadata = typeof audit.metadata === "string" ? JSON.parse(audit.metadata) : audit.metadata;
    assert.equal(metadata.delivery, "email");
  } finally {
    __setInvitationMail(NO_MAIL);
    await cleanUp(ids);
  }
});

test("an invitation link locks after too many wrong email answers, and only a new invitation reopens it", async () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `locked-${suffix}@example.test`;
  const res = response();
  let ids;

  try {
    await createClient(clientRequest(suffix, email, { companyCode: `QL${suffix}`.slice(0, 30) }), res);
    assert.equal(res.statusCode, 201);
    ids = { companyId: res.body.data.company.companyId, userId: res.body.data.administrator.userId };
    const token = tokenIn(res.body.data.inviteUrl);

    // Accepting with the wrong address is refused, counted, and changes nothing.
    const refused = response();
    await acceptInvitation(
      { body: { token, email: "someone@else.test", newPassword: PASSWORD, firstName: "Maria", lastName: "Santos" }, headers: {}, socket: {} },
      refused
    );
    assert.equal(refused.statusCode, 403);
    assert.equal(refused.body.code, "INVITATION_EMAIL_MISMATCH");
    const [[stillInvited]] = await db.execute("SELECT status FROM users WHERE user_id = ?", [ids.userId]);
    assert.equal(stillInvited.status, "invited");

    // The rest of the allowance, then the lock.
    let last;
    for (let i = 1; i < MAX_EMAIL_ATTEMPTS; i += 1) {
      last = response();
      await verifyInvitation({ body: { token, email: `guess${i}@else.test` } }, last);
    }
    assert.equal(last.statusCode, 423);
    assert.equal(last.body.code, "INVITATION_LOCKED");

    // Locked for good: even the right address no longer works, on any step.
    const right = response();
    await verifyInvitation({ body: { token, email } }, right);
    assert.equal(right.statusCode, 423);
    const peek = response();
    await checkInvitation({ query: { token } }, peek);
    assert.equal(peek.statusCode, 423);
    const accept = response();
    await acceptInvitation(
      { body: { token, email, newPassword: PASSWORD, firstName: "Maria", lastName: "Santos" }, headers: {}, socket: {} },
      accept
    );
    assert.equal(accept.statusCode, 423);

    // A fresh invitation starts a clean count.
    const resend = response();
    await resendInvitation(
      {
        params: { id: ids.userId },
        context: { companyId: ids.companyId, userId: null },
        user: { userId: null, email: "system@example.test" }, headers: {}, socket: {},
      },
      resend
    );
    assert.equal(resend.statusCode, 200);
    const fresh = tokenIn(resend.body.data.inviteUrl);
    const reopened = response();
    await verifyInvitation({ body: { token: fresh, email } }, reopened);
    assert.equal(reopened.statusCode, 200);
  } finally {
    await cleanUp(ids);
  }
});
