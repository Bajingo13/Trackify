import "../../config/env.js";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import db from "../../config/db.js";
import { __setEngine, __resetAllowance } from "../../shared/licenseScan/licenseScan.service.js";
import { scanLicense } from "./licenseScan.controller.js";
import { updateDriver, driverStats } from "./drivers.controller.js";
import { manilaToday } from "../../shared/driverLicense.js";

/**
 * The office reading a licence, and being the only place one is edited.
 *
 * A duplicate number has to be caught while the person is still looking at the
 * card, and a licence written here is exactly what the Driver App then shows.
 */

const CARD = `
LAND TRANSPORTATION OFFICE
DRIVER'S LICENSE
Last Name, First Name, Middle Name
DELA CRUZ, JUAN SANTOS
Date of Birth
1990/01/15
License No. Expiration Date
N01-12-345678 2031/01/15
`;

let restore = () => {};
afterEach(() => { restore(); __setEngine(null); });
beforeEach(() => { __resetAllowance(); });

function withDb(handler) {
  const calls = [];
  const real = db.execute;
  db.execute = async (sql, params) => {
    const text = String(sql).replace(/\s+/g, " ").trim();
    calls.push({ sql: text, params });
    return handler(text, params);
  };
  restore = () => { db.execute = real; };
  return calls;
}

const recorder = () => {
  const out = { statusCode: 200 };
  out.res = {
    status(code) { out.statusCode = code; return this; },
    json(value) { out.body = value; return this; },
  };
  return out;
};

const staff = (extra = {}) => ({
  context: { companyId: 7, branchId: 1, userId: 5 },
  user: { userId: 5, email: "office@example.com" },
  headers: {}, socket: {}, params: {}, query: {}, body: {},
  ...extra,
});

/* ---- scanning ---- */

test("a scan reads the card, and reports another driver already holding the number", async () => {
  __setEngine({ recognise: async () => ({ text: CARD, confidence: 90 }) });
  const calls = withDb((sql) => (sql.includes("AND license_key = ?") ? [[{ driver_id: 4, employee_no: "DRV-004", first_name: "Juan", last_name: "Dela Cruz", status: "active" }]] : [{}]));
  const r = recorder();
  await scanLicense(staff({ file: { path: "x.jpg", mimetype: "image/jpeg" } }), r.res);

  assert.equal(r.body.data.status, "read");
  assert.deepEqual(r.body.data.duplicateOf, { driverId: 4, name: "Juan Dela Cruz", employeeNo: "DRV-004", inactive: false });
  // scoped to the company, and (when editing) excluding the driver being edited
  const check = calls.find((c) => c.sql.includes("AND license_key = ?"));
  assert.deepEqual(check.params, [7, "N0112345678", 0], "compared without separators");
});

test("editing a driver does not flag their own number as a duplicate", async () => {
  __setEngine({ recognise: async () => ({ text: CARD, confidence: 90 }) });
  const calls = withDb(() => [[undefined]]);
  const r = recorder();
  await scanLicense(staff({ query: { driverId: "4" }, file: { path: "x.jpg", mimetype: "image/jpeg" } }), r.res);

  assert.equal(r.body.data.duplicateOf, undefined);
  assert.equal(calls.find((c) => c.sql.includes("AND license_key = ?")).params[2], 4);
});

test("no duplicate lookup is made when no number could be read", async () => {
  __setEngine({ recognise: async () => ({ text: "LAND TRANSPORTATION OFFICE\nDRIVER'S LICENSE", confidence: 80 }) });
  const calls = withDb(() => [[undefined]]);
  const r = recorder();
  await scanLicense(staff({ file: { path: "x.jpg", mimetype: "image/jpeg" } }), r.res);
  assert.equal(calls.filter((c) => c.sql.includes("license_key")).length, 0);
});

test("a PDF gets an explanation, not an error", async () => {
  const calls = withDb(() => [{}]);
  const r = recorder();
  await scanLicense(staff({ file: { path: "x.pdf", mimetype: "application/pdf" } }), r.res);
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.data.status, "unsupported");
  assert.equal(calls.length, 0);
});

/* ---- the office is the only place a licence is edited ---- */

test("the office saving a licence writes exactly the columns the Driver App reads, scoped to its company", async () => {
  const calls = withDb((sql) => {
    if (sql.startsWith("SELECT driver_id, status")) return [[{ driver_id: 4, status: "active", license_no: "OLD" }]];
    if (sql.includes("AND license_key = ? AND driver_id <> ?")) return [[]];
    return [{}];
  });
  const r = recorder();
  await updateDriver(staff({ params: { id: "4" }, body: { licenseNo: "N01-99-111111", licenseType: "Student", licenseExpiry: "2031-06-30" } }), r.res);
  const update = calls.find((c) => c.sql.startsWith("UPDATE drivers"));
  assert.equal(update.sql, "UPDATE drivers SET license_no = ?, license_type = ?, license_expiry = ? WHERE driver_id = ?");
  assert.deepEqual(update.params, ["N01-99-111111", "Student", "2031-06-30", 4]);
  assert.ok(calls.some((c) => c.sql.includes("INSERT INTO audit_logs")), "and it is audited");
});

test("a driver in another company cannot be edited", async () => {
  const calls = withDb((sql) => (sql.startsWith("SELECT driver_id, status") ? [[]] : [{}]));
  const r = recorder();
  await updateDriver(staff({ params: { id: "4" }, body: { licenseExpiry: "2031-06-30" } }), r.res);
  assert.equal(r.statusCode, 404);
  assert.equal(calls.some((c) => c.sql.startsWith("UPDATE")), false);
});

test("an edit to a licence another driver holds is refused, however it is typed", async () => {
  const calls = withDb((sql) => {
    if (sql.startsWith("SELECT driver_id, status")) return [[{ driver_id: 4, status: "active", employee_no: "DRV-004", license_no: "OLD" }]];
    if (sql.includes("AND license_key = ? AND driver_id <> ?")) return [[{ driver_id: 9, employee_no: "DRV-009", first_name: "Ana", last_name: "Lim", status: "active" }]];
    return [{}];
  });
  const r = recorder();
  await updateDriver(staff({ params: { id: "4" }, body: { licenseNo: "n01 99 111111" } }), r.res);
  assert.equal(r.statusCode, 409);
  assert.equal(r.body.code, "LICENSE_DUPLICATE");
  assert.match(r.body.message, /Ana Lim \(DRV-009\)/);
  assert.deepEqual(calls.find((c) => c.sql.includes("license_key = ?")).params, [7, "N0199111111", 4]);
  assert.equal(calls.some((c) => c.sql.startsWith("UPDATE")), false);
});

/* ---- deactivating and bringing back ---- */

const driverRow = (status) => (sql) => {
  if (sql.startsWith("SELECT driver_id, status")) return [[{ driver_id: 4, status, employee_no: "DRV-004", license_no: "N01" }]];
  if (sql.startsWith("SELECT 1 FROM trip_assignments")) return [[]];
  return [{}];
};

test("an inactive driver can be reactivated, and the log says so", async () => {
  const calls = withDb(driverRow("inactive"));
  const r = recorder();
  await updateDriver(staff({ params: { id: "4" }, body: { status: "active" } }), r.res);
  assert.equal(r.statusCode, 200);
  const update = calls.find((c) => c.sql.startsWith("UPDATE drivers"));
  assert.deepEqual(update.params, ["active", 4]);
  const audit = calls.find((c) => c.sql.includes("INSERT INTO audit_logs"));
  assert.ok(audit.params.includes("driver.reactivate"));
  assert.ok(audit.params.includes("Reactivated driver DRV-004"));
});

test("deactivating is logged as a deactivation", async () => {
  const calls = withDb(driverRow("active"));
  await updateDriver(staff({ params: { id: "4" }, body: { status: "inactive" } }), recorder().res);
  const audit = calls.find((c) => c.sql.includes("INSERT INTO audit_logs"));
  assert.ok(audit.params.includes("driver.deactivate"));
});

/* ---- the summary the Drivers page leads with ---- */

test("driver stats count the licences the office has to act on, by the shared rule", async () => {
  // the server counts licence days from Manila's date, which is a day ahead of UTC from 16:00 UTC
  const day = (offset) => manilaToday(new Date(Date.now() + offset * 86_400_000));
  const calls = withDb(() => [[
    { s: "available", license_expiry: day(-3) },   // expired
    { s: "available", license_expiry: day(10) },   // expiring
    { s: "on_trip", license_expiry: day(59) },     // expiring (60-day window)
    { s: "available", license_expiry: day(400) },  // fine
    { s: "available", license_expiry: null },      // a data gap is not a lapse
    { s: "inactive", license_expiry: day(-30) },   // not today's problem
  ]]);
  const r = recorder();
  await driverStats(staff(), r.res);

  assert.deepEqual(r.body.data.licence, { expired: 1, expiring: 2 }, "inactive drivers are left out");
  assert.equal(r.body.data.total, 6);
  assert.match(calls[0].sql, /company_id = \?/);
  assert.deepEqual(calls[0].params, [7]);
});

test("a free driver whose licence has lapsed is not counted as available", async () => {
  // Dispatch refuses them, so counting them showed capacity that did not exist.
  // the server counts licence days from Manila's date, which is a day ahead of UTC from 16:00 UTC
  const day = (offset) => manilaToday(new Date(Date.now() + offset * 86_400_000));
  withDb(() => [[
    { s: "available", license_expiry: day(100) },
    { s: "available", license_expiry: day(0) },    // good through today
    { s: "available", license_expiry: day(-1) },   // expired
    { s: "available", license_expiry: null },      // dispatch cannot check it, so refuses it
    { s: "on_trip", license_expiry: day(100) },
    { s: "inactive", license_expiry: day(100) },
  ]]);
  const r = recorder();
  await driverStats(staff(), r.res);
  assert.equal(r.body.data.available, 2);
  assert.equal(r.body.data.licenceBlocked, 2);
  assert.equal(r.body.data.onTrip, 1);
  assert.equal(r.body.data.inactive, 1);
});

test("an edit to an expiry no licence could have is refused, and nothing is written", async () => {
  const calls = withDb((sql) => (sql.startsWith("SELECT driver_id, status")
    ? [[{ driver_id: 4, status: "active", employee_no: "DRV-004", license_no: "N01" }]]
    : [{}]));
  const r = recorder();
  await updateDriver(staff({ params: { id: "4" }, body: { licenseExpiry: "2099-01-01" } }), r.res);
  assert.equal(r.statusCode, 400);
  assert.equal(r.body.code, "LICENSE_EXPIRY_IMPLAUSIBLE");
  assert.equal(calls.some((c) => c.sql.startsWith("UPDATE")), false);
});

test("an expiry already on file is not re-judged when something else is edited", async () => {
  // Saved before the range check existed: the edit form sends it back with every
  // edit, and a phone-number change must not be refused because of it.
  const calls = withDb((sql) => (sql.startsWith("SELECT driver_id, status")
    ? [[{ driver_id: 4, status: "active", employee_no: "DRV-004", license_no: "N01", license_expiry: "2045-01-01" }]]
    : [{}]));
  const r = recorder();
  await updateDriver(staff({ params: { id: "4" }, body: { phone: "0917", licenseExpiry: "2045-01-01" } }), r.res);
  assert.equal(r.statusCode, 200);
  assert.ok(calls.some((c) => c.sql.startsWith("UPDATE drivers")));
});
