import "../../config/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import db from "../../config/db.js";
import { login as staffLogin } from "./auth.controller.js";
import { login as driverLogin } from "../driver-app/driver.controller.js";

process.env.JWT_SECRET = process.env.JWT_SECRET || "auth-audit-test-secret";

/**
 * Sign-ins leave a record.
 *
 * Nothing recorded them before — no table, no audit entry, no last-login
 * column — so "who signed in, when, from where" had no answer at all. That is
 * the first question asked after an incident, and section 4.1 of the Terms
 * used to claim it was collected; the claim was removed rather than faked, and
 * this is the other half of putting that right.
 *
 * A failed attempt matters more than a successful one. Somebody walking PINs
 * or guessing passwords produces nothing but failures, and a log that only
 * holds successes cannot show it happening.
 */

async function withDb(handler, fn) {
  const real = db.execute;
  const calls = [];
  db.execute = async (sql, params) => {
    calls.push({ sql: String(sql).replace(/\s+/g, " ").trim(), params });
    return handler(String(sql), params);
  };
  try {
    return await fn(calls);
  } finally {
    db.execute = real;
  }
}

function recorder() {
  const out = { statusCode: 200 };
  out.res = {
    status(code) { out.statusCode = code; return this; },
    json(value) { out.body = value; return this; },
  };
  return out;
}

const req = (body, extra = {}) => ({
  body,
  headers: { "x-forwarded-for": "112.198.1.5", "user-agent": "Chrome" },
  socket: { remoteAddress: "10.0.0.1" },
  ...extra,
});

const auditRow = (calls) => calls.find((c) => c.sql.includes("INSERT INTO audit_logs"));
/* audit_logs column order: company, branch, user, actor_email, module, action,
 * entity_type, entity_id, summary, metadata, ip */
const AUDIT = { user: 2, actorEmail: 3, module: 4, action: 5, entityId: 7, summary: 8, metadata: 9, ip: 10 };

/* ---- staff ---- */

test("a sign-in attempt on an account that does not exist is recorded", async () => {
  await withDb(
    (sql) => (sql.startsWith("SELECT user_id") ? [[]] : [{ insertId: 1 }]),
    async (calls) => {
      const out = recorder();
      await staffLogin(req({ email: "nobody@example.com", password: "wrong" }), out.res, () => {});

      assert.equal(out.statusCode, 401);
      const audit = auditRow(calls);
      assert.ok(audit, "a failed sign-in left no trace");
      assert.equal(audit.params[AUDIT.action], "sign_in.failed");
      // Nobody to attribute it to — the attempted address belongs in the
      // summary, not in a column meaning "this user did it".
      assert.equal(audit.params[AUDIT.user], null);
      assert.equal(audit.params[AUDIT.actorEmail], null);
      assert.match(audit.params[AUDIT.summary], /nobody@example\.com/);
      assert.equal(audit.params[AUDIT.ip], "112.198.1.5");
    }
  );
});

test("a wrong password on a real account is recorded against that account", async () => {
  // The distinction matters: guessing at an address that exists is a different
  // event from guessing at one that does not.
  const password_hash = await bcrypt.hash("the-real-one", 10);
  await withDb(
    (sql) =>
      sql.startsWith("SELECT user_id")
        ? [[{ user_id: 7, email: "staff@example.com", password_hash, status: "active" }]]
        : [{ insertId: 1 }],
    async (calls) => {
      const out = recorder();
      await staffLogin(req({ email: "staff@example.com", password: "guess" }), out.res, () => {});

      assert.equal(out.statusCode, 401);
      const audit = auditRow(calls);
      assert.equal(audit.params[AUDIT.action], "sign_in.failed");
      assert.equal(audit.params[AUDIT.entityId], "7");
      assert.match(String(audit.params[AUDIT.metadata]), /wrong password/);
    }
  );
});

test("an inactive account is recorded as refused, not as a wrong password", async () => {
  // Somebody whose access was revoked still trying to get in is worth seeing,
  // and it is not the same event as a bad password.
  const password_hash = await bcrypt.hash("correct", 10);
  await withDb(
    (sql) =>
      sql.startsWith("SELECT user_id")
        ? [[{ user_id: 7, email: "gone@example.com", password_hash, status: "inactive" }]]
        : [{ insertId: 1 }],
    async (calls) => {
      const out = recorder();
      await staffLogin(req({ email: "gone@example.com", password: "correct" }), out.res, () => {});

      assert.equal(out.statusCode, 403);
      assert.equal(auditRow(calls).params[AUDIT.action], "sign_in.refused");
    }
  );
});

/* ---- driver app ---- */

test("a driver signing in is recorded against their company", async () => {
  const pin_hash = await bcrypt.hash("1234", 10);
  await withDb(
    (sql) =>
      sql.includes("FROM drivers")
        ? [[{ driver_id: 4, company_id: 2, home_branch_id: 5, first_name: "Juan", last_name: "Cruz", pin_hash }]]
        : [{ insertId: 1 }],
    async (calls) => {
      const out = recorder();
      await driverLogin(req({ employeeNo: "DRV-004", pin: "1234" }), out.res);

      assert.equal(out.body.success, true);
      const audit = auditRow(calls);
      assert.equal(audit.params[AUDIT.action], "sign_in");
      assert.equal(audit.params[AUDIT.module], "driver-app");
      // Driver routes sit outside the staff context chain, so the company is
      // attached explicitly — otherwise this lands against no company at all.
      assert.equal(audit.params[0], 2);
      assert.equal(audit.params[AUDIT.entityId], "4");
    }
  );
});

test("a failed driver sign-in is recorded even though there is no session", async () => {
  const pin_hash = await bcrypt.hash("9999", 10);
  await withDb(
    (sql) =>
      sql.includes("FROM drivers")
        ? [[{ driver_id: 4, company_id: 2, home_branch_id: 5, first_name: "Juan", last_name: "Cruz", pin_hash }]]
        : [{ insertId: 1 }],
    async (calls) => {
      const out = recorder();
      await driverLogin(req({ employeeNo: "DRV-004", pin: "1234" }), out.res);

      assert.equal(out.statusCode, 401);
      const audit = auditRow(calls);
      assert.equal(audit.params[AUDIT.action], "sign_in.failed");
      assert.match(audit.params[AUDIT.summary], /DRV-004/);
    }
  );
});
