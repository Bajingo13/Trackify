import "../../config/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import db from "../../config/db.js";
import { assignTrip, getBoard, getRecommendations } from "./dispatch.controller.js";

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
  const trips = calls.find((c) => c.sql.includes("FROM trip_tickets tt"));
  assert.match(trips.sql, /tt\.scheduled_arrival/);
  assert.match(trips.sql, /tt\.route_duration_min/);
  assert.deepEqual(drivers.params, [1, "2026-10-15", "2026-10-15", 2]);
  assert.deepEqual(vehicles.params, [1, 2, "2026-10-15", "2026-10-15", "2026-10-15", "2026-10-15"]);
});

/** A connection that answers assignTrip's checks, failing the one named. */
function fakeConnection({ refuse, trip = {}, driver = {}, vehicle = {} }) {
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
      if (sql.includes("FROM trip_tickets")) return [[{ trip_ticket_id: 5, status: "approved", ...trip }]];
      if (sql.includes("FROM drivers")) return [refuse === "driver" ? [] : [{ driver_id: 3, ...driver }]];
      if (sql.includes("FROM vehicles")) return [refuse === "vehicle" ? [] : [{ vehicle_id: 4, ...vehicle }]];
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

async function assignWith(resources) {
  const conn = fakeConnection(resources);
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
  assert.deepEqual(check.params, [3, 1, "2026-10-15", "2026-10-15"]);
  assert.equal(out.statusCode, 409);
  assert.equal(conn.rolledBack, true);
});

test("a vehicle with an expired registration cannot be assigned by naming it directly", async (t) => {
  // The board already hides it; the server has to refuse it too.
  t.mock.timers.enable({ apis: ["Date"], now: MANILA_MORNING });
  const { out, conn } = await assign("vehicle");

  const check = conn.calls.find((c) => c.sql.includes("FROM vehicles"));
  assert.match(check.sql, /registration_expiry IS NULL OR registration_expiry >= \?/);
  assert.deepEqual(check.params, [4, 1, "2026-10-15", "2026-10-15", "2026-10-15", "2026-10-15"]);
  assert.equal(out.statusCode, 409);
  assert.match(out.body.message, /registration has expired/);
});

test("assignment rejects a vehicle whose type does not meet the trip requirement", async () => {
  const { out, conn } = await assignWith({
    trip: { required_vehicle_type: "Box Truck", cargo_weight: 1000 },
    vehicle: { vehicle_type: "Tanker", capacity: 5000 },
  });
  assert.equal(out.statusCode, 409);
  assert.equal(out.body.code, "VEHICLE_TYPE_MISMATCH");
  assert.equal(conn.rolledBack, true);
});

test("assignment rejects cargo above the selected vehicle's capacity", async () => {
  const { out, conn } = await assignWith({
    trip: { required_vehicle_type: "Box Truck", cargo_weight: 6000 },
    vehicle: { vehicle_type: "Box Truck", capacity: 5000 },
  });
  assert.equal(out.statusCode, 409);
  assert.equal(out.body.code, "VEHICLE_CAPACITY_EXCEEDED");
  assert.equal(conn.rolledBack, true);
});

test("assignment rejects known cargo weight when vehicle capacity is missing", async () => {
  const { out, conn } = await assignWith({
    trip: { cargo_weight: 1000 },
    vehicle: { vehicle_type: "Box Truck", capacity: null },
  });
  assert.equal(out.statusCode, 409);
  assert.equal(out.body.code, "VEHICLE_CAPACITY_UNKNOWN");
  assert.equal(conn.rolledBack, true);
});

test("recommendations are scoped to the trip's company and branch and persist their reasons", async () => {
  const calls = [];
  const real = db.execute;
  db.execute = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes("FROM trip_tickets") && sql.includes("required_vehicle_type")) {
      return [[{
        id: 5, ticketNo: "TT-5", branchId: 2, originLat: 14.55, originLng: 121.02,
        cargoWeight: 2000, requiredVehicleType: "Box Truck", status: "approved",
      }]];
    }
    if (sql.includes("FROM drivers d")) {
      return [[{ id: 3, name: "Ana Driver", homeBranchId: 2, licenseExpiry: "2027-01-01", recentTripCount: 0 }]];
    }
    if (sql.includes("FROM vehicles v")) {
      return [[{ id: 4, plateNo: "ABC 123", type: "Box Truck", capacity: 3000, homeBranchId: 2 }]];
    }
    if (sql.includes("INSERT INTO dispatch_recommendation_runs")) return [{ insertId: 1 }];
    throw new Error(`Unexpected query: ${sql}`);
  };
  const out = recorder();
  out.res.set = () => out.res;
  try {
    await getRecommendations({ context: CONTEXT, params: { id: "5" } }, out.res);
  } finally {
    db.execute = real;
  }

  assert.equal(out.body.success, true);
  assert.equal(out.body.data.drivers[0].rank, 1);
  assert.equal(out.body.data.vehicles[0].rank, 1);
  const trip = calls.find((call) => call.sql.includes("required_vehicle_type"));
  assert.deepEqual(trip.params, [5, 1, 2]);
  const insert = calls.find((call) => call.sql.includes("INSERT INTO dispatch_recommendation_runs"));
  assert.equal(insert.params[1], 1);
  assert.equal(insert.params[2], 2);
  assert.match(insert.params[5], /Ana Driver/);
  assert.match(insert.params[6], /Matches required Box Truck/);
});

test("recommendations refuse a trip that is no longer awaiting dispatch", async () => {
  const real = db.execute;
  let calls = 0;
  db.execute = async () => {
    calls += 1;
    return [[{ id: 5, branchId: 2, status: "assigned" }]];
  };
  const out = recorder();
  try {
    await getRecommendations({ context: CONTEXT, params: { id: "5" } }, out.res);
  } finally {
    db.execute = real;
  }
  assert.equal(out.statusCode, 409);
  assert.equal(calls, 1);
  assert.match(out.body.message, /approved, unassigned/);
});
