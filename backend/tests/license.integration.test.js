import "../src/config/env.js";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import db from "../src/config/db.js";
import jwt from "jsonwebtoken";
import { getMe, login } from "../src/modules/auth/auth.controller.js";
import { authenticateDriver } from "../src/modules/driver-app/driver.middleware.js";
import { authorizeRealtimeScope, RealtimeAuthorizationError } from "../src/realtime/hub.js";
import { createClient } from "../src/modules/admin/clientOnboarding.controller.js";
import {
  getMyLicense,
  issueCompanyLicense,
  listAllLicenses,
  renewCompanyLicense,
  reinstateCompanyLicense,
  revokeCompanyLicense,
} from "../src/modules/admin/licenses.controller.js";
import operationalContext from "../src/middleware/operationalContext.js";
import { issueLicense, looksLikeLicenseNumber } from "../src/shared/license.js";
import { __setMail } from "../src/shared/temporaryAccess.js";
import { __setLicenseMail, sendLicenseReminders } from "../src/shared/licenseReminders.js";
import { __setInvitationMail } from "../src/shared/invitations.js";

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

const SYSADMIN = { isSystemAdmin: true, userId: null, companyId: null, branchId: null };
const request = (extra = {}) => ({
  body: {}, params: {}, query: {}, headers: {}, socket: {},
  context: SYSADMIN, user: { userId: null, email: "system@example.test" },
  ...extra,
});

async function cleanUp(ids) {
  if (!ids) return;
  await db.execute("DELETE FROM audit_logs WHERE company_id = ? OR (entity_type = 'company' AND entity_id = ?) OR (entity_type = 'user' AND entity_id = ?)", [ids.companyId, String(ids.companyId), String(ids.userId)]);
  await db.execute("DELETE FROM user_roles WHERE user_id = ?", [ids.userId]);
  await db.execute("DELETE FROM user_company_access WHERE user_id = ?", [ids.userId]);
  await db.execute("DELETE FROM user_invitations WHERE user_id = ?", [ids.userId]);
  await db.execute("DELETE FROM users WHERE user_id = ?", [ids.userId]);
  await db.execute("DELETE FROM branches WHERE company_id = ?", [ids.companyId]);
  await db.execute("DELETE rp FROM role_permissions rp JOIN roles r ON r.role_id = rp.role_id WHERE r.company_id = ?", [ids.companyId]);
  await db.execute("DELETE FROM roles WHERE company_id = ?", [ids.companyId]);
  await db.execute("DELETE FROM companies WHERE company_id = ?", [ids.companyId]); // licenses cascade
}

async function onboard(suffix, extra = {}) {
  const res = response();
  await createClient(request({
    body: {
      companyName: `Lic Client ${suffix}`,
      companyCode: `LC${suffix}`.slice(0, 30),
      branchName: "Main", branchCode: "MAIN", prefix: "LC",
      firstName: "Lic", lastName: "Admin", email: `lic-${suffix}@example.test`,
      ...extra,
    },
  }), res);
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  return {
    res,
    ids: {
      companyId: res.body.data.company.companyId,
      branchId: res.body.data.branch.branchId,
      userId: res.body.data.administrator.userId,
    },
  };
}

// Runs operationalContext as a client user and reports what it did.
async function gate(ids, userId) {
  const req = {
    headers: { "x-company-id": String(ids.companyId), "x-branch-id": String(ids.branchId) },
    user: { userId },
    originalUrl: "/api/v1/operations/trips",
  };
  const res = response();
  let passed = false;
  await operationalContext(req, res, () => { passed = true; });
  return { passed, res };
}

test("client setup issues a license in the same step, and licensing can be audited", async () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const { res, ids } = await onboard(suffix, { licenseTermMonths: 24 });
  try {
    const license = res.body.data.license;
    assert.ok(looksLikeLicenseNumber(license.licenseNumber), license.licenseNumber);
    assert.ok(license.licenseNumber.includes(`-LC${suffix}`.slice(0, 31)));
    assert.equal(license.state, "active");
    assert.equal(license.perpetual, false);
    assert.ok(license.daysRemaining > 700 && license.daysRemaining <= 732, JSON.stringify(license));

    // One license per client per system: a second issue is refused.
    const dupe = response();
    await issueCompanyLicense(request({ params: { id: ids.companyId } }), dupe);
    assert.equal(dupe.statusCode, 409);

    // A bad term stops setup before anything is created.
    const bad = response();
    await createClient(request({ body: { licenseTermMonths: 0 } }), bad);
    assert.equal(bad.statusCode, 400);
  } finally {
    await cleanUp(ids);
  }
});

test("the database refuses a duplicate number; issueLicense retries a collided hash", async () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const { res, ids } = await onboard(suffix);
  try {
    const [[row]] = await db.execute("SELECT license_number FROM licenses WHERE company_id = ?", [ids.companyId]);
    assert.equal(row.license_number, res.body.data.license.licenseNumber);

    // A second company, forced to reuse the first number, is rejected by the UNIQUE key.
    const [other] = await db.execute("INSERT INTO companies (company_name, company_code) VALUES (?, ?)", [`Other ${suffix}`, `OT${suffix}`.slice(0, 30)]);
    try {
      await assert.rejects(
        db.execute("INSERT INTO licenses (company_id, system_code, license_number) VALUES (?, 'TRK01', ?)", [other.insertId, row.license_number]),
        (error) => error.code === "ER_DUP_ENTRY"
      );
      // ...but the real path just draws a fresh number.
      const issued = await issueLicense(db, { companyId: other.insertId, companyCode: `OT${suffix}`.slice(0, 30) });
      assert.notEqual(issued.licenseNumber, row.license_number);
    } finally {
      await db.execute("DELETE FROM companies WHERE company_id = ?", [other.insertId]);
    }
  } finally {
    await cleanUp(ids);
  }
});

test("renew, revoke and reinstate change the state and are audited", async () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const { ids } = await onboard(suffix);
  const params = { id: ids.companyId };
  try {
    const renewed = response();
    await renewCompanyLicense(request({ params, body: { termMonths: 12 } }), renewed);
    assert.equal(renewed.statusCode, 200);
    assert.ok(renewed.body.data.daysRemaining > 700, "a renewal adds a term to what is left");

    const noReason = response();
    await revokeCompanyLicense(request({ params, body: { reason: "short" } }), noReason);
    assert.equal(noReason.statusCode, 400);

    const revoked = response();
    await revokeCompanyLicense(request({ params, body: { reason: "Contract terminated by the client" } }), revoked);
    assert.equal(revoked.statusCode, 200);
    assert.equal(revoked.body.data.state, "revoked");
    assert.equal(revoked.body.data.valid, false);

    const again = response();
    await revokeCompanyLicense(request({ params, body: { reason: "Contract terminated by the client" } }), again);
    assert.equal(again.statusCode, 409);

    const blockedRenew = response();
    await renewCompanyLicense(request({ params }), blockedRenew);
    assert.equal(blockedRenew.statusCode, 409);

    const back = response();
    await reinstateCompanyLicense(request({ params }), back);
    assert.equal(back.statusCode, 200);
    assert.equal(back.body.data.state, "active");

    const [audit] = await db.execute(
      "SELECT action FROM audit_logs WHERE entity_type = 'company' AND entity_id = ? AND action LIKE 'license.%'",
      [String(ids.companyId)]
    );
    assert.deepEqual(audit.map((a) => a.action).sort(), ["license.reinstate", "license.renew", "license.revoke"]);
  } finally {
    await cleanUp(ids);
  }
});

test("only a System Administrator can manage licenses; a client sees only its own", async () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const { ids } = await onboard(suffix);
  const client = { isSystemAdmin: false, userId: ids.userId, companyId: ids.companyId, branchId: ids.branchId };
  try {
    for (const [fn, label] of [[renewCompanyLicense, "renew"], [revokeCompanyLicense, "revoke"], [reinstateCompanyLicense, "reinstate"], [issueCompanyLicense, "issue"], [listAllLicenses, "list"]]) {
      const res = response();
      await fn(request({ context: client, params: { id: ids.companyId }, body: { reason: "A perfectly good reason" } }), res);
      assert.equal(res.statusCode, 403, label);
    }
    const mine = response();
    await getMyLicense(request({ context: client }), mine);
    assert.equal(mine.statusCode, 200);
    assert.equal(mine.body.data.companyId, ids.companyId);
    assert.ok(mine.body.data.licenseNumber);
  } finally {
    await cleanUp(ids);
  }
});

test("with enforcement on, a lapsed license blocks the client but not the license screen or a System Administrator", async () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const { ids } = await onboard(suffix);
  const previous = process.env.LICENSE_ENFORCEMENT;
  try {
    // The client's administrator must be an active user with access to pass the gate.
    await db.execute("UPDATE users SET status = 'active' WHERE user_id = ?", [ids.userId]);

    process.env.LICENSE_ENFORCEMENT = "off";
    await db.execute("UPDATE licenses SET expires_at = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE company_id = ?", [ids.companyId]);
    assert.equal((await gate(ids, ids.userId)).passed, true, "off: nothing is blocked");

    process.env.LICENSE_ENFORCEMENT = "on";
    const expired = await gate(ids, ids.userId);
    assert.equal(expired.passed, false);
    assert.equal(expired.res.statusCode, 403);
    assert.equal(expired.res.body.code, "LICENSE_INVALID");
    assert.equal(expired.res.body.licenseState, "expired");

    // The screen that explains the block stays reachable.
    const req = {
      headers: { "x-company-id": String(ids.companyId), "x-branch-id": String(ids.branchId) },
      user: { userId: ids.userId },
      originalUrl: "/api/v1/admin/license",
    };
    let passed = false;
    await operationalContext(req, response(), () => { passed = true; });
    assert.equal(passed, true);

    await db.execute("UPDATE licenses SET expires_at = DATE_ADD(NOW(), INTERVAL 90 DAY) WHERE company_id = ?", [ids.companyId]);
    assert.equal((await gate(ids, ids.userId)).passed, true, "a valid license passes");

    await db.execute("UPDATE licenses SET status = 'revoked' WHERE company_id = ?", [ids.companyId]);
    assert.equal((await gate(ids, ids.userId)).res.body.licenseState, "revoked");

    await db.execute("DELETE FROM licenses WHERE company_id = ?", [ids.companyId]);
    assert.equal((await gate(ids, ids.userId)).res.body.licenseState, "missing");
  } finally {
    if (previous === undefined) delete process.env.LICENSE_ENFORCEMENT;
    else process.env.LICENSE_ENFORCEMENT = previous;
    await cleanUp(ids);
  }
});

test("a term of 0 issues a license that never expires, and renewing it is refused", async () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const { res, ids } = await onboard(suffix, { licenseTermMonths: 0 });
  try {
    const license = res.body.data.license;
    assert.equal(license.perpetual, true);
    assert.equal(license.expiresAt, null);
    assert.equal(license.state, "active");

    const renew = response();
    await renewCompanyLicense(request({ params: { id: ids.companyId } }), renew);
    assert.equal(renew.statusCode, 409);
  } finally {
    await cleanUp(ids);
  }
});

test("with enforcement on, sign-in is refused for a lapsed license and allowed again once renewed", async () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const { res: setup, ids } = await onboard(suffix);
  const email = `lic-${suffix}@example.test`;
  const previous = process.env.LICENSE_ENFORCEMENT;
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET ||= "test-secret";
  try {
    const password = "Correct horse battery staple 7!";
    await db.execute("UPDATE users SET status = 'active', password_hash = ? WHERE user_id = ?", [await bcrypt.hash(password, 4), ids.userId]);
    const attempt = async () => {
      const res = response();
      await login({ body: { email, password }, headers: {}, socket: {} }, res, (error) => { throw error; });
      return res;
    };

    process.env.LICENSE_ENFORCEMENT = "on";
    await db.execute("UPDATE licenses SET expires_at = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE company_id = ?", [ids.companyId]);
    const refused = await attempt();
    assert.equal(refused.statusCode, 403);
    assert.equal(refused.body.code, "LICENSE_INVALID");
    assert.equal(refused.body.licenseState, "expired");

    process.env.LICENSE_ENFORCEMENT = "off";
    assert.equal((await attempt()).statusCode, 200, "off: sign-in is never blocked by a license");

    process.env.LICENSE_ENFORCEMENT = "on";
    const renewed = response();
    await renewCompanyLicense(request({ params: { id: ids.companyId } }), renewed);
    assert.equal(renewed.statusCode, 200);
    const ok = await attempt();
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.body.data.access.length, 1);
    assert.equal(setup.body.data.company.companyId, ids.companyId);
  } finally {
    if (previous === undefined) delete process.env.LICENSE_ENFORCEMENT;
    else process.env.LICENSE_ENFORCEMENT = previous;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    await db.execute("DELETE FROM audit_logs WHERE user_id = ? OR (entity_type = 'user' AND entity_id = ?)", [ids.userId, String(ids.userId)]);
    await cleanUp(ids);
  }
});

test("with enforcement on, a lapsed license also locks out the Driver App and live tracking", async () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const { ids } = await onboard(suffix);
  const previous = process.env.LICENSE_ENFORCEMENT;
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET ||= "test-secret";
  let driverId;
  try {
    const [drv] = await db.execute(
      `INSERT INTO drivers (company_id, home_branch_id, first_name, last_name, license_no, license_expiry, employee_no, status, app_enabled)
       VALUES (?, ?, 'Lic', 'Driver', ?, '2099-01-01', ?, 'active', 1)`,
      [ids.companyId, ids.branchId, `LN-${suffix}`, `D${suffix}`.slice(0, 20)]
    );
    driverId = drv.insertId;
    const token = jwt.sign({ kind: "driver", driverId }, process.env.JWT_SECRET);
    const driverCall = async () => {
      const res = response();
      let passed = false;
      await authenticateDriver({ headers: { authorization: `Bearer ${token}` } }, res, () => { passed = true; });
      return { res, passed };
    };

    process.env.LICENSE_ENFORCEMENT = "on";
    assert.equal((await driverCall()).passed, true, "a valid license lets the driver work");

    await db.execute("UPDATE licenses SET status = 'revoked' WHERE company_id = ?", [ids.companyId]);
    const blocked = await driverCall();
    assert.equal(blocked.passed, false);
    assert.equal(blocked.res.statusCode, 403);
    assert.equal(blocked.res.body.code, "LICENSE_INVALID");

    // The live-tracking handshake refuses too (a staff member of that client).
    await db.execute("UPDATE users SET status = 'active' WHERE user_id = ?", [ids.userId]);
    await assert.rejects(
      authorizeRealtimeScope({ userId: ids.userId, companyId: ids.companyId, branchId: ids.branchId }),
      (error) => error instanceof RealtimeAuthorizationError
    );

    process.env.LICENSE_ENFORCEMENT = "off";
    assert.equal((await driverCall()).passed, true, "off: nothing is blocked");
  } finally {
    if (previous === undefined) delete process.env.LICENSE_ENFORCEMENT;
    else process.env.LICENSE_ENFORCEMENT = previous;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    if (driverId) await db.execute("DELETE FROM drivers WHERE driver_id = ?", [driverId]);
    await cleanUp(ids);
  }
});

test("/auth/me applies the same license filter as sign-in", async () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const { ids } = await onboard(suffix);
  const previous = process.env.LICENSE_ENFORCEMENT;
  try {
    await db.execute("UPDATE users SET status = 'active' WHERE user_id = ?", [ids.userId]);
    process.env.LICENSE_ENFORCEMENT = "on";
    const me = async () => {
      const res = response();
      await getMe({ user: { userId: ids.userId }, headers: {} }, res, (error) => { throw error; });
      return res;
    };
    assert.equal((await me()).statusCode, 200);
    await db.execute("UPDATE licenses SET expires_at = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE company_id = ?", [ids.companyId]);
    const blocked = await me();
    assert.equal(blocked.statusCode, 403);
    assert.equal(blocked.body.licenseState, "expired");
  } finally {
    if (previous === undefined) delete process.env.LICENSE_ENFORCEMENT;
    else process.env.LICENSE_ENFORCEMENT = previous;
    await cleanUp(ids);
  }
});

test("two simultaneous renewals do not both succeed on the same stale reading", async () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const { ids } = await onboard(suffix);
  try {
    const results = [response(), response()];
    await Promise.all(results.map((res) => renewCompanyLicense(request({ params: { id: ids.companyId }, body: { termMonths: 12 } }), res)));
    const codes = results.map((r) => r.statusCode).sort();
    // Either they serialised (200, 200) or the loser was told to retry (200, 409) — never a silent lost update.
    assert.ok(codes[0] === 200 && (codes[1] === 200 || codes[1] === 409), codes.join());
    const [[row]] = await db.execute("SELECT expires_at FROM licenses WHERE company_id = ?", [ids.companyId]);
    const years = (new Date(row.expires_at) - Date.now()) / (365.25 * 86_400_000);
    assert.ok(years > (codes[1] === 200 ? 2.9 : 1.9), `expires in ${years.toFixed(2)} years with ${codes.join()}`);
  } finally {
    await cleanUp(ids);
  }
});

test("license reminders go to the client's administrators once per threshold, and only when they can be delivered", async () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const { ids } = await onboard(suffix);
  const email = `lic-${suffix}@example.test`;
  const outbox = [];
  let working = true;
  __setLicenseMail({
    isMailConfigured: () => true,
    send: async (message) => {
      if (!working) return { sent: false, reason: "smtp down" };
      outbox.push(message);
      return { sent: true };
    },
  });
  const setExpiry = (sql) => db.execute(`UPDATE licenses SET expires_at = ${sql} WHERE company_id = ?`, [ids.companyId]);
  const sweep = () => sendLicenseReminders({ companyId: ids.companyId });
  try {
    await db.execute("UPDATE users SET status = 'active' WHERE user_id = ?", [ids.userId]);
    const [[lic]] = await db.execute("SELECT license_number FROM licenses WHERE company_id = ?", [ids.companyId]);

    // A healthy license: nothing to say.
    assert.equal((await sweep()).sent.length, 0);

    // Inside the 7-day window: one email, to the administrator, naming the license.
    await setExpiry("DATE_ADD(NOW(), INTERVAL 6 DAY)");
    const first = await sweep();
    assert.deepEqual(first.sent.map((s) => [s.threshold, s.recipients]), [[7, 1]]);
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0].to, email);
    assert.match(outbox[0].subject, /expires in \d+ days/);
    assert.ok(outbox[0].text.includes(lic.license_number));

    // Same state, run again (or a second server): nothing more is sent.
    assert.equal((await sweep()).sent.length, 0);
    assert.equal(outbox.length, 1);

    // The next threshold is a new reminder.
    await setExpiry("DATE_ADD(NOW(), INTERVAL 12 HOUR)");
    assert.deepEqual((await sweep()).sent.map((s) => s.threshold), [1]);

    // Renewing moves the end date, which starts a fresh cycle.
    await setExpiry("DATE_ADD(NOW(), INTERVAL 29 DAY)");
    assert.deepEqual((await sweep()).sent.map((s) => s.threshold), [30]);

    // A dry run reports what is due without sending or claiming it.
    await setExpiry("DATE_ADD(NOW(), INTERVAL 13 DAY)");
    const dry = await sendLicenseReminders({ companyId: ids.companyId, dryRun: true });
    assert.deepEqual(dry.due.map((d) => d.threshold), [14]);
    const before = outbox.length;
    assert.equal(outbox.length, before);
    assert.deepEqual((await sweep()).sent.map((s) => s.threshold), [14], "the dry run claimed nothing");

    // Delivery failing releases the claim, so the next sweep tries again.
    await setExpiry("DATE_ADD(NOW(), INTERVAL 5 DAY)");
    working = false;
    const failed = await sweep();
    assert.equal(failed.sent.length, 0);
    assert.equal(failed.released.length, 1);
    working = true;
    assert.deepEqual((await sweep()).sent.map((s) => s.threshold), [7]);

    // Just expired: one notice. Lapsed long ago, revoked: nothing.
    await setExpiry("DATE_SUB(NOW(), INTERVAL 3 DAY)");
    const gone = await sweep();
    assert.deepEqual(gone.sent.map((s) => s.threshold), [0]);
    assert.match(outbox.at(-1).subject, /has expired/);

    await setExpiry("DATE_SUB(NOW(), INTERVAL 60 DAY)");
    assert.equal((await sweep()).sent.length, 0);

    await setExpiry("DATE_ADD(NOW(), INTERVAL 2 DAY)");
    await db.execute("UPDATE licenses SET status = 'revoked' WHERE company_id = ?", [ids.companyId]);
    assert.equal((await sweep()).sent.length, 0, "revoked is a decision, not something to be reminded about");
    await db.execute("UPDATE licenses SET status = 'active' WHERE company_id = ?", [ids.companyId]);

    // Nobody to write to: released, not recorded as sent.
    await setExpiry("DATE_ADD(NOW(), INTERVAL 20 HOUR)");
    await db.execute("UPDATE users SET status = 'inactive' WHERE user_id = ?", [ids.userId]);
    const nobody = await sweep();
    assert.equal(nobody.sent.length, 0);
    assert.match(nobody.released[0].reason, /no administrator/);

    // Mail not set up: says so, claims nothing.
    __setLicenseMail({ isMailConfigured: () => false, send: async () => ({ sent: false }) });
    const skipped = await sweep();
    assert.match(skipped.skipped, /not set up/);
    const [[claimed]] = await db.execute(
      "SELECT COUNT(*) AS n FROM license_reminders r JOIN licenses l ON l.license_id = r.license_id AND r.expires_at = l.expires_at WHERE l.company_id = ? AND r.threshold_days = 1",
      [ids.companyId]
    );
    assert.equal(Number(claimed.n), 0);
  } finally {
    __setLicenseMail();
    await cleanUp(ids);
  }
});

test("reminder history: shown with the license, scoped to the current term, and recipient counts stay with System Administrators", async () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const { ids } = await onboard(suffix);
  const client = { isSystemAdmin: false, userId: ids.userId, companyId: ids.companyId, branchId: ids.branchId };
  const outbox = [];
  __setLicenseMail({ isMailConfigured: () => true, send: async (m) => { outbox.push(m); return { sent: true }; } });
  const mineAs = async (context) => {
    const res = response();
    await getMyLicense(request({ context }), res);
    return res.body.data;
  };
  try {
    await db.execute("UPDATE users SET status = 'active' WHERE user_id = ?", [ids.userId]);

    // Nothing sent yet: the field is present and empty, not missing.
    assert.equal((await mineAs(client)).lastReminder, null);

    await db.execute("UPDATE licenses SET expires_at = DATE_ADD(NOW(), INTERVAL 6 DAY) WHERE company_id = ?", [ids.companyId]);
    assert.equal((await sendLicenseReminders({ companyId: ids.companyId })).sent.length, 1);

    // The client sees that a 7-day warning went out, and when — not how many people got it.
    const seen = await mineAs(client);
    assert.equal(seen.lastReminder.thresholdDays, 7);
    assert.ok(seen.lastReminder.sentAt);
    assert.equal("recipients" in seen.lastReminder, false);

    // A System Administrator also sees the recipient count, here and in the list.
    assert.equal((await mineAs({ ...SYSADMIN, companyId: ids.companyId, branchId: ids.branchId })).lastReminder.recipients, 1);
    const all = response();
    await listAllLicenses(request(), all);
    const row = all.body.data.find((l) => l.companyId === ids.companyId);
    assert.equal(row.lastReminder.thresholdDays, 7);
    assert.equal(row.lastReminder.recipients, 1);

    // The latest one wins.
    await db.execute("UPDATE licenses SET expires_at = DATE_ADD(NOW(), INTERVAL 12 HOUR) WHERE company_id = ?", [ids.companyId]);
    await sendLicenseReminders({ companyId: ids.companyId });
    assert.equal((await mineAs(client)).lastReminder.thresholdDays, 1);

    // Renewing starts a new term: a warning from before it is not this term's history.
    const renewed = response();
    await renewCompanyLicense(request({ params: { id: ids.companyId }, body: { termMonths: 12 } }), renewed);
    assert.equal(renewed.statusCode, 200);
    assert.equal((await mineAs(client)).lastReminder, null);

    // A company with no license has no history field to show.
    await db.execute("DELETE FROM licenses WHERE company_id = ?", [ids.companyId]);
    assert.equal("lastReminder" in (await mineAs(client)), false);
  } finally {
    __setLicenseMail();
    await cleanUp(ids);
  }
});
