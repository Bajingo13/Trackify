import "../../config/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import db from "../../config/db.js";
import { me, updateMe, history, allExpenses } from "./driverProfile.controller.js";

/**
 * The driver's own account.
 *
 * Every handler here is scoped to req.driver and none of them takes an id, so
 * what these tests guard is not routing but the two things that have already
 * been wrong once: which assignment rows count toward a driver's totals, and
 * what a claim's status actually means to the person waiting on the money.
 */

/** Runs `fn` with db.execute replaced, and always puts the real one back. */
async function withDb(handler, fn) {
  const real = db.execute;
  const calls = [];
  db.execute = async (sql, params) => {
    calls.push({ sql, params });
    return handler(sql, params);
  };
  try {
    return await fn(calls);
  } finally {
    db.execute = real;
  }
}

function recorder() {
  const out = {};
  out.res = {
    status(code) { out.statusCode = code; return this; },
    json(value) { out.body = value; return this; },
  };
  return out;
}

const DRIVER = { driverId: 9, companyId: 7 };

const PROFILE_ROW = {
  driver_id: 9,
  employee_no: "DRV-001",
  first_name: "Juan",
  last_name: "Dela Cruz",
  phone: "0917",
  license_no: "N01-12-345678",
  license_type: null,
  license_expiry: null,
  emergency_contact_name: null,
  emergency_contact_phone: null,
  emergency_contact_relation: null,
  status: "active",
  created_at: new Date(),
  photo_path: null,
  photo_updated_at: null,
  branch_name: "Davao Branch",
  branch_code: "DVO",
  company_name: "AstreaBlue Logistics",
};

test("a driver with no record gets 404 rather than an empty profile", async () => {
  const r = recorder();
  await withDb(
    (sql) => (sql.includes("FROM drivers d") ? [[undefined]] : [[{}]]),
    () => me({ driver: DRIVER }, r.res)
  );
  assert.equal(r.statusCode, 404);
  assert.equal(r.body.success, false);
});

test("lifetime totals count only the current assignment for a trip", async () => {
  // A trip reassigned between drivers keeps one trip_assignments row per
  // assignment. Without is_current the same run counts two or three times and
  // the driver is shown a number they know is wrong.
  let tallySql = "";
  const r = recorder();
  await withDb((sql) => {
    if (sql.includes("FROM drivers d")) return [[PROFILE_ROW]];
    if (sql.includes("COUNT(*) AS trips")) {
      tallySql = sql;
      return [[{ trips: 4, km: 275.4 }]];
    }
    throw new Error(`Unexpected query: ${sql}`);
  }, () => me({ driver: DRIVER }, r.res));

  assert.match(tallySql, /ta\.is_current = TRUE/);
  assert.equal(r.body.data.totals.trips, 4);
  assert.equal(r.body.data.totals.km, 275);
});

test("a licence with no expiry recorded reports no countdown", async () => {
  const r = recorder();
  await withDb((sql) => {
    if (sql.includes("FROM drivers d")) return [[PROFILE_ROW]];
    return [[{ trips: 0, km: 0 }]];
  }, () => me({ driver: DRIVER }, r.res));

  assert.equal(r.body.data.license.daysLeft, null);
});

test("saving nothing is refused instead of writing an empty UPDATE", async () => {
  const r = recorder();
  await withDb(() => { throw new Error("must not touch the database"); },
    () => updateMe({ driver: DRIVER, body: {} }, r.res));

  assert.equal(r.statusCode, 400);
});

test("a blank field clears the column rather than storing an empty string", async () => {
  const r = recorder();
  const calls = await withDb((sql) => {
    if (sql.startsWith("UPDATE drivers")) return [{ affectedRows: 1 }];
    if (sql.includes("FROM drivers d")) return [[PROFILE_ROW]];
    return [[{ trips: 0, km: 0 }]];
  }, async (calls) => {
    await updateMe({ driver: DRIVER, body: { phone: "   " } }, r.res);
    return calls;
  });

  const update = calls.find((c) => c.sql.startsWith("UPDATE drivers"));
  assert.equal(update.params[0], null, "a whitespace-only phone should null the column");
});

test("history asks only for runs that are finished, on the current assignment", async () => {
  let sql = "";
  const r = recorder();
  await withDb((q) => { sql = q; return [[]]; },
    () => history({ driver: DRIVER, query: {} }, r.res));

  assert.match(sql, /ta\.is_current = TRUE/);
  assert.match(sql, /'delivered','returned','operationally_closed','cancelled'/);
});

test("a caller cannot ask history for an unbounded page", async () => {
  // LIMIT is interpolated because MySQL prepared statements will not reliably
  // take a parameter there, so the clamp is the only thing between a query
  // string and the whole table.
  let sql = "";
  const r = recorder();
  await withDb((q) => { sql = q; return [[]]; },
    () => history({ driver: DRIVER, query: { limit: "100000", offset: "-5" } }, r.res));

  assert.match(sql, /LIMIT 100 OFFSET 0/);
});

test("a reimbursed claim is money already paid, not money still owed", async () => {
  // This was wrong once. 'recorded' means accepted into the books and
  // 'reimbursed' means the cash is back; collapsing them tells a driver they
  // are still owed for something settled last month, and that ends with
  // somebody claiming twice.
  const r = recorder();
  await withDb(() => [[
    { expense_id: 1, trip_ticket_id: 1, ticket_no: "T-1", category: "fuel", description: null,
      amount: "1000.00", expense_date: "2026-09-07", receipt_no: null, status: "reimbursed",
      review_note: null, reviewed_at: null, created_at: null, attachment_count: 1 },
    { expense_id: 2, trip_ticket_id: 1, ticket_no: "T-1", category: "toll", description: null,
      amount: "250.00", expense_date: "2026-09-07", receipt_no: null, status: "submitted",
      review_note: null, reviewed_at: null, created_at: null, attachment_count: 0 },
    { expense_id: 3, trip_ticket_id: 1, ticket_no: "T-1", category: "meal", description: null,
      amount: "500.00", expense_date: "2026-09-07", receipt_no: null, status: "recorded",
      review_note: null, reviewed_at: null, created_at: null, attachment_count: 1 },
  ]], () => allExpenses({ driver: DRIVER, query: {} }, r.res));

  assert.deepEqual(r.body.totals, {
    waiting: 250,
    approved: 500,
    paid: 1000,
    rejected: 0,
  });
});

test("an unfamiliar claim status is treated as still waiting, never as paid", async () => {
  const r = recorder();
  await withDb(() => [[
    { expense_id: 1, trip_ticket_id: 1, ticket_no: "T-1", category: "fuel", description: null,
      amount: "400.00", expense_date: null, receipt_no: null, status: "some_future_state",
      review_note: null, reviewed_at: null, created_at: null, attachment_count: 0 },
  ]], () => allExpenses({ driver: DRIVER, query: {} }, r.res));

  assert.equal(r.body.totals.waiting, 400);
  assert.equal(r.body.totals.paid, 0);
});
