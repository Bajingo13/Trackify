import "../../config/env.js";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import db from "../../config/db.js";
import { __setEngine, __resetAllowance } from "../../shared/licenseScan/licenseScan.service.js";
import { scanLicense } from "./licenseScan.controller.js";
import { updateDriver, driverStats } from "./drivers.controller.js";

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
  const calls = withDb((sql) => (sql.includes("AND license_no = ?") ? [[{ driver_id: 4, first_name: "Juan", last_name: "Dela Cruz" }]] : [{}]));
  const r = recorder();
  await scanLicense(staff({ file: { path: "x.jpg", mimetype: "image/jpeg" } }), r.res);

  assert.equal(r.body.data.status, "read");
  assert.deepEqual(r.body.data.duplicateOf, { driverId: 4, name: "Juan Dela Cruz" });
  // scoped to the company, and (when editing) excluding the driver being edited
  const check = calls.find((c) => c.sql.includes("AND license_no = ?"));
  assert.deepEqual(check.params, [7, "N01-12-345678", 0]);
});

test("editing a driver does not flag their own number as a duplicate", async () => {
  __setEngine({ recognise: async () => ({ text: CARD, confidence: 90 }) });
  const calls = withDb(() => [[undefined]]);
  const r = recorder();
  await scanLicense(staff({ query: { driverId: "4" }, file: { path: "x.jpg", mimetype: "image/jpeg" } }), r.res);

  assert.equal(r.body.data.duplicateOf, undefined);
  assert.equal(calls.find((c) => c.sql.includes("AND license_no = ?")).params[2], 4);
});

test("no duplicate lookup is made when no number could be read", async () => {
  __setEngine({ recognise: async () => ({ text: "LAND TRANSPORTATION OFFICE\nDRIVER'S LICENSE", confidence: 80 }) });
  const calls = withDb(() => [[undefined]]);
  const r = recorder();
  await scanLicense(staff({ file: { path: "x.jpg", mimetype: "image/jpeg" } }), r.res);
  assert.equal(calls.filter((c) => c.sql.includes("license_no")).length, 0);
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
    if (sql.includes("AND license_no = ? AND driver_id <> ?")) return [[]];
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

/* ---- the summary the Drivers page leads with ---- */

test("driver stats count the licences the office has to act on, by the shared rule", async () => {
  const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  withDb((sql) => {
    if (sql.includes("GROUP BY s")) return [[{ s: "available", n: 4 }, { s: "inactive", n: 1 }]];
    return [[
      { license_expiry: day(-3) },   // expired
      { license_expiry: day(10) },   // expiring
      { license_expiry: day(59) },   // expiring (60-day window)
      { license_expiry: day(400) },  // fine
      { license_expiry: null },      // a data gap is not a lapse
    ]];
  });
  const r = recorder();
  await driverStats(staff(), r.res);

  assert.deepEqual(r.body.data.licence, { expired: 1, expiring: 2 });
  assert.equal(r.body.data.total, 5);
});

test("inactive drivers are not counted in the licence summary", async () => {
  const calls = withDb((sql) => (sql.includes("GROUP BY s") ? [[]] : [[]]));
  await driverStats(staff(), recorder().res);
  const query = calls.find((c) => c.sql.includes("license_expiry"));
  assert.match(query.sql, /status <> 'inactive'/);
  assert.match(query.sql, /company_id = \?/);
});
