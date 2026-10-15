import "../config/env.js";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  sendDriverLicenseReminders, scheduleDriverLicenseReminders, reminderScheduleEnabled, pushText,
  __setReminderMail, __setReminderPush,
} from "./driverLicenseReminders.js";
import { driverLicenseDigestEmail } from "./driverLicense.email.js";

/**
 * The daily licence reminders.
 *
 * The properties that matter are the ones that stop it becoming spam or going
 * silent: every threshold is sent once and only once, only the most urgent is
 * sent, a notice that reached nobody is not counted as sent, and a missing
 * mail or push configuration is reported rather than pretended around.
 */

const NOW = new Date("2026-10-15T04:00:00Z"); // 12:00 in Manila

const driver = (id, expiry, extra = {}) => ({
  driver_id: id, company_id: 1, employee_no: `DRV-00${id}`, first_name: "Juan", last_name: `Cruz${id}`,
  license_no: `N01-12-00000${id}`, license_expiry: expiry, app_enabled: 1, company_name: "AstreaBlue Logistics",
  ...extra,
});

/** An in-memory stand-in for the two tables and the one query the sweep makes. */
function fakeDb({ drivers = [], managers = [{ user_id: 1, email: "ops@example.com", first_name: "Ops" }] } = {}) {
  const claims = new Map(); // "driver|date|threshold|audience" -> id
  let next = 1;
  const log = { deletes: 0, updates: [] };
  const key = (p) => p.join("|");
  return {
    claims, log,
    managers,
    async execute(sql, params) {
      const s = String(sql).replace(/\s+/g, " ").trim();
      if (s.startsWith("SELECT d.driver_id")) return [drivers];
      if (s.startsWith("INSERT IGNORE INTO driver_license_reminders")) {
        const k = key(params);
        if (claims.has(k)) return [{ affectedRows: 0, insertId: 0 }];
        claims.set(k, next);
        next += 1;
        return [{ affectedRows: 1, insertId: next - 1 }];
      }
      if (s.startsWith("SELECT COUNT(*)")) return [[{ n: claims.has(key(params)) ? 1 : 0 }]];
      if (s.startsWith("UPDATE driver_license_reminders")) { log.updates.push(params); return [{}]; }
      if (s.startsWith("DELETE FROM driver_license_reminders")) {
        for (const [k, id] of claims) if (id === params[0]) claims.delete(k);
        log.deletes += 1;
        return [{}];
      }
      throw new Error(`unexpected SQL: ${s}`);
    },
    async query() { return [this.managers]; },
  };
}

let mails;
let pushes;
function configure({ mail = true, push = true, deliver = true } = {}) {
  mails = [];
  pushes = [];
  __setReminderMail({
    isMailConfigured: () => mail,
    send: async (message) => { mails.push(message); return { sent: deliver }; },
  });
  __setReminderPush({
    pushEnabled: () => push,
    notifyDriver: async (n) => { pushes.push(n); return { sent: 1, removed: 0 }; },
  });
}
beforeEach(() => configure());
afterEach(() => { __setReminderMail(null); __setReminderPush(null); });

const sweep = (db, opts = {}) => sendDriverLicenseReminders({ runner: db, now: NOW, ...opts });

/* ---- the thresholds ---- */

test("a licence 5 days out gets the 7-day notice: one push, one email", async () => {
  const db = fakeDb({ drivers: [driver(1, "2026-10-20")] });
  const r = await sweep(db);

  assert.equal(r.driver.sent.length, 1);
  assert.equal(r.driver.sent[0].threshold, 7);
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].driverId, 1);
  assert.equal(pushes[0].tag, "license-expiry");
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, "ops@example.com");
  assert.equal(r.office.sent.length, 1);
});

test("running it again sends nothing more", async () => {
  const db = fakeDb({ drivers: [driver(1, "2026-10-20")] });
  await sweep(db);
  const again = await sweep(db);

  assert.equal(again.driver.sent.length, 0);
  assert.equal(again.office.sent.length, 0);
  assert.equal(pushes.length, 1);
  assert.equal(mails.length, 1);
});

test("two servers sweeping at once cannot both send", async () => {
  const db = fakeDb({ drivers: [driver(1, "2026-10-20")] });
  await Promise.all([sweep(db), sweep(db)]);
  assert.equal(pushes.length, 1, "the claim is taken before sending, so only one wins");
  assert.equal(mails.length, 1);
});

test("a licence that crosses the next threshold is told again", async () => {
  const db = fakeDb({ drivers: [driver(1, "2026-10-20")] });
  await sweep(db); // 7-day notice
  await sendDriverLicenseReminders({ runner: db, now: new Date("2026-10-19T04:00:00Z") }); // tomorrow: 1-day
  assert.equal(pushes.length, 2);
  assert.match(pushes[1].body, /tomorrow/);
});

test("renewing starts a fresh cycle", async () => {
  // The expiry date is part of the claim's key, so a renewed licence that is
  // near expiry again is a new notice, not one already sent. (Renewed to a
  // date that is itself close here, to keep it inside the window.)
  const db = fakeDb({ drivers: [driver(1, "2026-10-20")] });
  await sweep(db);
  assert.equal(pushes.length, 1);

  db.execute = ((original) => async (sql, params) => {
    if (String(sql).includes("SELECT d.driver_id")) return [[driver(1, "2026-10-18")]];
    return original(sql, params);
  })(db.execute.bind(db));
  const r = await sweep(db);
  assert.equal(r.driver.sent.length, 1, "a different expiry date is a different notice");
  assert.equal(pushes.length, 2);
});

test("an expired licence is announced with its own wording", async () => {
  const db = fakeDb({ drivers: [driver(1, "2026-10-14")] });
  const r = await sweep(db);

  assert.equal(r.driver.sent[0].threshold, 0);
  assert.match(pushes[0].title, /expired/i);
  assert.match(pushes[0].body, /can't be assigned trips/);
  assert.match(mails[0].subject, /expired/i);
});

test("one that lapsed weeks ago is not announced as news", async () => {
  const db = fakeDb({ drivers: [driver(1, "2026-09-01")] });
  const r = await sweep(db);
  assert.equal(r.driver.sent.length, 0);
  assert.equal(mails.length, 0);
});

test("a licence still far off is not mentioned", async () => {
  const db = fakeDb({ drivers: [driver(1, "2027-06-01")] });
  const r = await sweep(db);
  assert.equal(r.driver.sent.length, 0);
});

/* ---- the digest ---- */

test("several licences in one company are one email, not several", async () => {
  const db = fakeDb({ drivers: [driver(1, "2026-10-20"), driver(2, "2026-10-14"), driver(3, "2026-11-10")] });
  const r = await sweep(db);

  assert.equal(mails.length, 1);
  assert.equal(r.office.sent.length, 3);
  assert.equal(pushes.length, 3, "but each driver is told about their own");
  assert.match(mails[0].subject, /3 driver licences need attention/);
  assert.match(mails[0].text, /Cruz2/);
  assert.match(mails[0].text, /Expired yesterday/);
});

test("every manager gets the digest", async () => {
  const db = fakeDb({
    drivers: [driver(1, "2026-10-20")],
    managers: [{ email: "a@example.com", first_name: "A" }, { email: "b@example.com", first_name: "B" }],
  });
  const r = await sweep(db);
  assert.deepEqual(mails.map((m) => m.to).sort(), ["a@example.com", "b@example.com"]);
  assert.equal(r.office.sent[0].recipients, 2);
});

/* ---- not pretending ---- */

test("with nobody to write to, the office claim is released so the next sweep tries again", async () => {
  const db = fakeDb({ drivers: [driver(1, "2026-10-20")], managers: [] });
  const r = await sweep(db);
  assert.equal(r.office.sent.length, 0);
  assert.equal(r.office.released.length, 1);
  assert.match(r.office.released[0].reason, /nobody who manages drivers/);

  db.managers = [{ email: "ops@example.com", first_name: "Ops" }];
  const retry = await sweep(db);
  assert.equal(retry.office.sent.length, 1, "now it can be delivered");
  assert.equal(retry.driver.sent.length, 0, "and the driver is not told twice");
});

test("an email that could not be delivered is not counted as sent", async () => {
  configure({ deliver: false });
  const db = fakeDb({ drivers: [driver(1, "2026-10-20")] });
  const r = await sweep(db);
  assert.equal(r.office.sent.length, 0);
  assert.match(r.office.released[0].reason, /no email could be delivered/);
});

test("with no mail set up the driver is still told, and the gap is reported", async () => {
  configure({ mail: false });
  const db = fakeDb({ drivers: [driver(1, "2026-10-20")] });
  const r = await sweep(db);
  assert.equal(pushes.length, 1);
  assert.equal(mails.length, 0);
  assert.match(r.office.skipped, /Email is not set up/);
});

test("with no push set up the office is still told, and the gap is reported", async () => {
  configure({ push: false });
  const db = fakeDb({ drivers: [driver(1, "2026-10-20")] });
  const r = await sweep(db);
  assert.equal(pushes.length, 0);
  assert.equal(mails.length, 1);
  assert.match(r.driver.skipped, /not set up/);
});

test("a driver without the app is not pushed, but the office still hears", async () => {
  const db = fakeDb({ drivers: [driver(1, "2026-10-20", { app_enabled: 0 })] });
  const r = await sweep(db);
  assert.equal(pushes.length, 0);
  assert.equal(r.office.sent.length, 1);
});

test("a dry run reports what is due and sends and claims nothing", async () => {
  const db = fakeDb({ drivers: [driver(1, "2026-10-20")] });
  const r = await sweep(db, { dryRun: true });
  assert.equal(r.due.length, 1);
  assert.deepEqual(r.due[0].audiences, ["driver", "office"]);
  assert.equal(pushes.length + mails.length, 0);
  assert.equal(db.claims.size, 0);

  await sweep(db);
  const after = await sweep(db, { dryRun: true });
  assert.equal(after.due.length, 0, "already sent, so no longer due");
});

/* ---- wording ---- */

test("the lock-screen text says the date is near and nothing more", () => {
  assert.equal(pushText(12).body, "Your driver's licence expires in 12 days. Open the app to review it.");
  assert.match(pushText(1).body, /expires tomorrow/);
  assert.match(pushText(0).body, /expires today/);
  assert.match(pushText(-3).title, /expired/);
  for (const d of [12, 1, 0, -3]) assert.doesNotMatch(JSON.stringify(pushText(d)), /N01-|\d{2}-\d{6}/, "no licence number on a lock screen");
});

test("a single-licence email names the driver, plural ones count them", () => {
  const one = driverLicenseDigestEmail({
    name: "Ops", companyName: "AstreaBlue", url: "http://x/fleet/drivers",
    items: [{ driver: "Juan Cruz", employeeNo: "DRV-001", licenseNo: "N01-12-000001", expiry: "2026-10-20", daysLeft: 5 }],
  });
  assert.match(one.subject, /Driver licence expiring: Juan Cruz/);
  assert.match(one.html, /Expires in 5 days/);
  assert.match(one.text, /N01-12-000001/);
});

test("names are escaped in the HTML email", () => {
  const m = driverLicenseDigestEmail({
    name: "Ops", companyName: "AstreaBlue", url: "http://x",
    items: [{ driver: "<img src=x onerror=alert(1)>", employeeNo: null, licenseNo: null, expiry: "2026-10-20", daysLeft: 5 }],
  });
  assert.doesNotMatch(m.html, /<img src=x/);
});

/* ---- scheduling ---- */

test("the automatic sweep runs in production and nowhere else unless asked", () => {
  // A dev server restarts on every saved file and its demo managers have real-
  // looking addresses: running by itself there would email them each time.
  assert.equal(reminderScheduleEnabled({ NODE_ENV: "production" }), true);
  assert.equal(reminderScheduleEnabled({ RAILWAY_ENVIRONMENT: "production" }), true);
  assert.equal(reminderScheduleEnabled({ NODE_ENV: "development" }), false);
  assert.equal(reminderScheduleEnabled({}), false);
  assert.equal(reminderScheduleEnabled({ NODE_ENV: "development", DRIVER_LICENSE_REMINDERS: "on" }), true);
  assert.equal(reminderScheduleEnabled({ NODE_ENV: "production", DRIVER_LICENSE_REMINDERS: "off" }), false);
});

test("when it is not enabled the schedule does nothing but say so", async () => {
  const lines = [];
  let swept = false;
  const timer = scheduleDriverLicenseReminders({
    enabled: false,
    log: { log: (l) => lines.push(l), error() {} },
    sweep: async () => { swept = true; return {}; },
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(timer, null);
  assert.equal(swept, false);
  assert.match(lines[0], /off outside production/);
});

test("the schedule logs what happened and never throws", async () => {
  const lines = [];
  const log = { log: (l) => lines.push(l), error: (l) => lines.push(`ERR ${l}`) };
  const timer = scheduleDriverLicenseReminders({
    enabled: true,
    intervalMs: 3_600_000,
    log,
    sweep: async () => ({
      considered: 1,
      driver: { sent: [{ driver: "Juan Cruz", daysLeft: 5, devices: 1 }], notified: 1 },
      office: { sent: [], released: [{ driver: "Juan Cruz", company: "AstreaBlue", reason: "no email could be delivered" }] },
    }),
  });
  clearInterval(timer);
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(lines.some((l) => /notified Juan Cruz/.test(l)));
  assert.ok(lines.some((l) => /ERR .*not sent: no email could be delivered/.test(l)));

  const bad = [];
  const t2 = scheduleDriverLicenseReminders({
    enabled: true,
    intervalMs: 3_600_000,
    log: { log() {}, error: (l) => bad.push(l) },
    sweep: async () => { throw new Error("db down"); },
  });
  clearInterval(t2);
  await new Promise((r) => setTimeout(r, 20));
  assert.match(bad[0], /db down/);
});
