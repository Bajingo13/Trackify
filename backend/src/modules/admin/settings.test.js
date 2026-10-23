import "../../config/env.js";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import db from "../../config/db.js";
import {
  getCompanySettings,
  updateCompanySettings,
  setMyAlertPreferences,
  ALERT_TYPES,
} from "./settings.controller.js";
import { generateTripNumber } from "../operations/trip-number.service.js";

/**
 * The settings screens, held to the one promise a settings screen makes.
 *
 * Both of these pages rendered a placeholder until now. The failure worth
 * testing for is not a crash — it is a control that accepts a value, says it
 * saved, and changes nothing. So these check what the setting does, not that
 * the endpoint returned 200.
 */

const realExecute = db.execute.bind(db);
const realGetConnection = db.getConnection.bind(db);
after(async () => {
  db.execute = realExecute;
  db.getConnection = realGetConnection;
  await db.end();
});

let sql = [];
let settingsRow = null;

beforeEach(() => {
  sql = [];
  db.execute = async (text, params = []) => {
    sql.push({ text: String(text).replace(/\s+/g, " ").trim(), params });
    if (/FROM company_settings/i.test(text)) return [settingsRow ? [settingsRow] : []];
    if (/FROM user_alert_mutes/i.test(text)) return [[]];
    return [{ affectedRows: 1, insertId: 1 }];
  };
  db.getConnection = async () => ({
    execute: (text, params) => db.execute(text, params),
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
  });
});

const reqFor = (body = {}) => ({
  body,
  context: { companyId: 1, branchId: 1, userId: 9 },
  user: { userId: 9, email: "dispatcher@example.com" },
  // recordAudit reads both for the actor's IP, and swallows its own errors —
  // a fake request without them loses the entry silently.
  headers: {},
  socket: { remoteAddress: "127.0.0.1" },
});

const resFor = () => {
  const res = { statusCode: 200, payload: null };
  res.status = (code) => ((res.statusCode = code), res);
  res.json = (payload) => ((res.payload = payload), res);
  return res;
};

test("the ticket prefix that is saved is the prefix the next ticket gets", async () => {
  /*
   * The point of the setting. The generator hardcoded "TT" while the seeded
   * tickets read "DVO-", so a company's own paperwork name is exactly what it
   * was never able to set.
   */
  const connection = {
    execute: async (text) => {
      if (/FROM company_settings/i.test(text)) {
        return [[{ trip_prefix: "DVO", location_retention_months: 12 }]];
      }
      if (/FROM trip_sequences/i.test(text)) return [[{ sequence_id: 3, last_number: 41 }]];
      return [{ affectedRows: 1 }];
    },
  };

  const ticketNo = await generateTripNumber(connection, 1, 1);
  assert.equal(ticketNo, `DVO-${new Date().getFullYear()}-000042`);
});

test("a company that set nothing still gets the number format it always had", async () => {
  const connection = {
    execute: async (text) => {
      if (/FROM company_settings/i.test(text)) return [[]];
      if (/FROM trip_sequences/i.test(text)) return [[]];
      return [{ affectedRows: 1 }];
    },
  };

  assert.match(await generateTripNumber(connection, 1, 1), /^TT-\d{4}-000001$/);
});

test("the prefix is read on the caller's connection, inside its transaction", async () => {
  // Read off the pool instead and a settings change committed mid-transaction
  // could give one ticket the old prefix and the next number the new one.
  let onPool = 0;
  db.execute = async () => ((onPool += 1), [[]]);
  const connection = {
    execute: async (text) => {
      if (/FROM company_settings/i.test(text)) {
        return [[{ trip_prefix: "TT", location_retention_months: 12 }]];
      }
      if (/FROM trip_sequences/i.test(text)) return [[]];
      return [{ affectedRows: 1 }];
    },
  };

  await generateTripNumber(connection, 1, 1);
  assert.equal(onPool, 0, "the settings read went to the pool, not the transaction");
});

test("a prefix that would not survive a spreadsheet is refused, not stored", async () => {
  const res = resFor();
  await updateCompanySettings(reqFor({ tripPrefix: "TT 2026/A" }), res);

  assert.equal(res.statusCode, 400);
  assert.equal(sql.filter((s) => /INSERT INTO company_settings/i.test(s.text)).length, 0);
});

test("a retention period outside the defensible range is refused", async () => {
  for (const months of [0, 240, "a while"]) {
    const res = resFor();
    // eslint-disable-next-line no-await-in-loop
    await updateCompanySettings(reqFor({ locationRetentionMonths: months }), res);
    assert.equal(res.statusCode, 400, `accepted ${months}`);
  }
  assert.equal(sql.filter((s) => /INSERT INTO company_settings/i.test(s.text)).length, 0);
});

test("changing one setting does not quietly reset the other", async () => {
  // A PATCH of the prefix alone must not write the default retention over an
  // eighteen-month period somebody chose deliberately.
  settingsRow = { trip_prefix: "TT", location_retention_months: 18 };
  const res = resFor();
  await updateCompanySettings(reqFor({ tripPrefix: "ABC" }), res);

  assert.equal(res.payload.data.tripPrefix, "ABC");
  assert.equal(res.payload.data.locationRetentionMonths, 18);
  const insert = sql.find((s) => /INSERT INTO company_settings/i.test(s.text));
  // the emergency line was not sent, so it is not written either
  assert.deepEqual(insert.params, [1, "ABC", 18, 9]);
  assert.doesNotMatch(insert.text, /emergency_line/);
  settingsRow = null;
});

test("shortening the retention period is written to the audit log", async () => {
  /*
   * It destroys data on a schedule from then on. That must not be discoverable
   * only by noticing the data is gone.
   */
  settingsRow = { trip_prefix: "TT", location_retention_months: 12 };
  await updateCompanySettings(reqFor({ locationRetentionMonths: 3 }), resFor());

  const audit = sql.find((s) => /INSERT INTO audit_logs/i.test(s.text));
  assert.ok(audit, "no audit entry was written");
  assert.ok(
    audit.params.some((p) => typeof p === "string" && /location trail 12 . 3 months/.test(p)),
    audit.params.join(" | ")
  );
  settingsRow = null;
});

test("saving the same values again writes no audit entry", async () => {
  // An audit log full of changes that changed nothing is one nobody reads.
  settingsRow = { trip_prefix: "TT", location_retention_months: 12 };
  await updateCompanySettings(reqFor({ tripPrefix: "TT", locationRetentionMonths: 12 }), resFor());

  assert.equal(sql.filter((s) => /INSERT INTO audit_logs/i.test(s.text)).length, 0);
  settingsRow = null;
});

test("a mute for an alert the system never raises is refused", async () => {
  // Storing it would look like it took and do nothing — the exact failure this
  // screen exists to avoid.
  const res = resFor();
  await setMyAlertPreferences(reqFor({ muted: ["trip_delay", "asteroid_strike"] }), res);

  assert.equal(res.statusCode, 400);
  assert.match(res.payload.message, /asteroid_strike/);
});

test("every alert kind the screen offers is one the system actually raises", async () => {
  /*
   * The list is duplicated in the frontend service; if a type is added there
   * and not here, the toggle appears and the mute is rejected on save.
   */
  const service = await fs.readFile(
    new URL("../../../../frontend/src/services/operations/exceptionService.js", import.meta.url),
    "utf8"
  );
  for (const type of ALERT_TYPES) {
    // The frontend holds them as object keys, unquoted: `trip_delay: "Trip Delay"`.
    assert.match(service, new RegExp(`\\b${type}:`), `${type} is not in the frontend list`);
  }
});

test("an empty preference set means everything reaches you", async () => {
  // Mutes, not subscriptions: somebody who never opened this page cannot be
  // the one missing a failed delivery.
  const res = resFor();
  await setMyAlertPreferences(reqFor({ muted: [] }), res);

  assert.deepEqual(res.payload.data.muted, []);
  assert.equal(sql.filter((s) => /DELETE FROM user_alert_mutes/i.test(s.text)).length, 1);
  assert.equal(sql.filter((s) => /INSERT INTO user_alert_mutes/i.test(s.text)).length, 0);
});

test("the screen shows the number a ticket will actually carry", async () => {
  settingsRow = { trip_prefix: "DVO", location_retention_months: 12 };
  const res = resFor();
  await getCompanySettings(reqFor(), res);

  assert.match(res.payload.data.sampleTicketNo, new RegExp(`^DVO-${new Date().getFullYear()}-`));
  settingsRow = null;
});

/* ---------------------------------------------------------------- */
/* The emergency line                                               */
/* ---------------------------------------------------------------- */

async function asProduction(fn) {
  const before = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try { return await fn(); } finally { process.env.NODE_ENV = before; }
}

test("with no line saved, a development server offers the demo number, marked as demo", async () => {
  settingsRow = { trip_prefix: "TT", location_retention_months: 12, emergency_line: null };
  const res = resFor();
  await getCompanySettings(reqFor(), res);

  assert.equal(res.payload.data.emergencyLine, null);
  assert.equal(res.payload.data.emergencyLineDemo, "+63 900 000 0000");
  settingsRow = null;
});

test("production never offers the demo number", async () => {
  settingsRow = { trip_prefix: "TT", location_retention_months: 12, emergency_line: null };
  const res = resFor();
  await asProduction(() => getCompanySettings(reqFor(), res));

  assert.equal(res.payload.data.emergencyLine, null);
  assert.equal(res.payload.data.emergencyLineDemo, null);
  settingsRow = null;
});

test("a saved line is written, returned, and recorded in the audit log", async () => {
  settingsRow = { trip_prefix: "TT", location_retention_months: 12, emergency_line: null };
  const res = resFor();
  await updateCompanySettings(reqFor({ emergencyLine: "  +63 82 224   1234 " }), res);

  assert.equal(res.statusCode, 200);
  const insert = sql.find((s) => /INSERT INTO company_settings/i.test(s.text));
  assert.match(insert.text, /emergency_line = VALUES\(emergency_line\)/);
  assert.deepEqual(insert.params, [1, "TT", 12, "+63 82 224 1234", 9]);
  assert.equal(res.payload.data.emergencyLine, "+63 82 224 1234");
  assert.equal(res.payload.data.emergencyLineDemo, null);

  const audit = sql.find((s) => /INSERT INTO audit_logs/i.test(s.text));
  assert.ok(audit, "no audit entry was written");
  assert.ok(audit.params.some((p) => typeof p === "string" && /emergency line none . \+63 82 224 1234/.test(p)));
  settingsRow = null;
});

test("updating the line replaces the old one, and clearing it stores nothing", async () => {
  settingsRow = { trip_prefix: "TT", location_retention_months: 12, emergency_line: "(082) 224-1234" };
  let res = resFor();
  await updateCompanySettings(reqFor({ emergencyLine: "911" }), res);
  assert.equal(res.payload.data.emergencyLine, "911");
  assert.ok(sql.some((s) => /INSERT INTO audit_logs/i.test(s.text) && s.params.some((p) => /\(082\) 224-1234 . 911/.test(String(p)))));

  sql = [];
  res = resFor();
  await updateCompanySettings(reqFor({ emergencyLine: "" }), res);
  const insert = sql.find((s) => /INSERT INTO company_settings/i.test(s.text));
  assert.equal(insert.params[3], null);
  assert.equal(res.payload.data.emergencyLine, null);
  settingsRow = null;
});

test("something that is not a phone number is refused, and nothing is written", async () => {
  for (const value of ["call Juan", "12", "+63 917 123 4567 890 12", "0917+1234567", "<script>"]) {
    const res = resFor();
    // eslint-disable-next-line no-await-in-loop
    await updateCompanySettings(reqFor({ emergencyLine: value }), res);
    assert.equal(res.statusCode, 400, `accepted ${value}`);
  }
  assert.equal(sql.filter((s) => /INSERT INTO company_settings/i.test(s.text)).length, 0);
});

test("before migration 058, the line cannot be saved and nothing is half-saved; the rest still works", async () => {
  const stub = db.execute;
  db.execute = async (text, params) => {
    if (/emergency_line/i.test(text)) {
      throw Object.assign(new Error("Unknown column 'emergency_line'"), { code: "ER_BAD_FIELD_ERROR" });
    }
    return stub(text, params);
  };
  try {
    const res = resFor();
    await updateCompanySettings(reqFor({ tripPrefix: "ABC", emergencyLine: "911" }), res);
    assert.equal(res.statusCode, 503);
    assert.equal(sql.filter((s) => /INSERT INTO audit_logs/i.test(s.text)).length, 0);

    const ok = resFor();
    await updateCompanySettings(reqFor({ tripPrefix: "ABC" }), ok);
    assert.equal(ok.statusCode, 200);

    const read = resFor();
    await getCompanySettings(reqFor(), read);
    assert.equal(read.statusCode, 200);
    assert.equal(read.payload.data.emergencyLine, null);
  } finally {
    db.execute = stub;
  }
});

test("only someone who may manage the company can change the line", async () => {
  // The line goes through the one company-settings PATCH, guarded by company.manage.
  const routes = await fs.readFile(new URL("./admin.routes.js", import.meta.url), "utf8");
  assert.match(
    routes,
    /router\.patch\("\/settings\/company", requirePermission\("company\.manage"\), asyncHandler\(settings\.updateCompanySettings\)\)/
  );
  assert.equal((routes.match(/settings\.updateCompanySettings/g) || []).length, 1, "a second route reaches the update");
});
