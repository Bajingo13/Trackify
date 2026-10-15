import "../../config/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import db from "../../config/db.js";
import { assignTrip, getBoard } from "./dispatch.controller.js";

/**
 * Who dispatch treats as eligible "today".
 *
 * Licences and registrations are good through their expiry date on the
 * Philippine calendar. The database may run in UTC, so "today" is passed in
 * rather than read from CURDATE(): otherwise an expired licence stays
 * assignable from 00:00 to 08:00 Manila time.
 */

// 2026-10-15 03:00 in Manila, still 2026-10-14 in UTC.
const MANILA_MORNING = new Date("2026-10-14T19:00:00Z");
const CONTEXT = { companyId: 1, branchId: 2, userId: 9 };

function recorder() {
  const out = {};
  out.res = {
    status(code) { out.statusCode = code; return this; },
    json(value) { out.body = value; return this; },
  };
  return out;
}

test("the board lists drivers and vehicles against today in Manila", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: MANILA_MORNING });
  const calls = [];
  const real = db.execute;
  db.execute = async (sql, params) => { calls.push({ sql, params }); return [[]]; };
  try {
    await getBoard({ context: CONTEXT }, recorder().res);
  } finally {
    db.execute = real;
  }

  for (const call of calls) assert.doesNotMatch(call.sql, /CURDATE|CURRENT_DATE/);
  const drivers = calls.find((c) => c.sql.includes("d.license_expiry >= ?"));
  const vehicles = calls.find((c) => c.sql.includes("v.registration_expiry >= ?"));
  assert.deepEqual(drivers.params, [1, "2026-10-15", 2]);
  assert.deepEqual(vehicles.params, [1, 2, "2026-10-15"]);
});

/** A connection that answers assignTrip's checks, failing the one named. */
function fakeConnection({ refuse }) {
  const calls = [];
  const conn = {
    calls,
    rolledBack: false,
    async beginTransaction() {},
    async rollback() { conn.rolledBack = true; },
    async commit() {},
    release() {},
    async execute(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("FROM trip_tickets")) return [[{ trip_ticket_id: 5, status: "approved" }]];
      if (sql.includes("FROM drivers")) return [refuse === "driver" ? [] : [{ driver_id: 3 }]];
      if (sql.includes("FROM vehicles")) return [refuse === "vehicle" ? [] : [{ vehicle_id: 4 }]];
      return [[]];
    },
  };
  return conn;
}

async function assign(refuse) {
  const conn = fakeConnection({ refuse });
  const real = db.getConnection;
  db.getConnection = async () => conn;
  const out = recorder();
  try {
    await assignTrip({ context: CONTEXT, params: { id: "5" }, body: { driverId: 3, vehicleId: 4 } }, out.res);
  } finally {
    db.getConnection = real;
  }
  return { out, conn };
}

test("assigning checks the driver's licence against today in Manila", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: MANILA_MORNING });
  const { out, conn } = await assign("driver");

  const check = conn.calls.find((c) => c.sql.includes("FROM drivers"));
  assert.match(check.sql, /license_expiry >= \?/);
  assert.doesNotMatch(check.sql, /CURDATE/);
  assert.deepEqual(check.params, [3, 1, "2026-10-15"]);
  assert.equal(out.statusCode, 409);
  assert.equal(conn.rolledBack, true);
});

test("a vehicle with an expired registration cannot be assigned by naming it directly", async (t) => {
  // The board already hides it; the server has to refuse it too.
  t.mock.timers.enable({ apis: ["Date"], now: MANILA_MORNING });
  const { out, conn } = await assign("vehicle");

  const check = conn.calls.find((c) => c.sql.includes("FROM vehicles"));
  assert.match(check.sql, /registration_expiry IS NULL OR registration_expiry >= \?/);
  assert.deepEqual(check.params, [4, 1, "2026-10-15"]);
  assert.equal(out.statusCode, 409);
  assert.match(out.body.message, /registration has expired/);
});
