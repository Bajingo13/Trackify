import "../../config/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import db from "../../config/db.js";
import { runTransition } from "./trip-status.service.js";

/**
 * Closing a trip adds the distance it drove to the vehicle's odometer. A trip
 * whose driver entered an end odometer reading has already moved the vehicle's
 * odometer to that reading, so closing it must not add the distance again.
 */

function closeWith({ endReading }) {
  const odometerUpdates = [];
  const run = async (sql, params = []) => {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.includes("FROM trip_tickets") && q.includes("FOR UPDATE")) {
      return [[{ trip_ticket_id: 55, ticket_no: "TT-55", status: "delivered", route_distance_km: 30 }]];
    }
    if (q.startsWith("SELECT vehicle_id FROM trip_assignments")) return [[{ vehicle_id: 77 }]];
    if (q.includes("FROM trip_odometer_readings")) {
      return [endReading ? [{ reading_id: 2, kind: "end", value_km: 120250, corrected_value_km: null }] : []];
    }
    if (q.includes("FROM trip_tracking_points")) {
      return [[{ latitude: 7.0, longitude: 125.0 }, { latitude: 7.1, longitude: 125.0 }]];
    }
    if (q.startsWith("UPDATE vehicles SET odometer")) odometerUpdates.push(params);
    if (/^\s*SELECT/i.test(q)) return [[]];
    return [{}];
  };
  const saved = { execute: db.execute, getConnection: db.getConnection };
  db.execute = run;
  db.getConnection = async () => ({ beginTransaction: async () => {}, execute: run, commit: async () => {}, rollback: async () => {}, release() {} });
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(v) { this.body = v; return this; } };
  const req = { params: { id: "55" }, body: {}, context: { companyId: 7, branchId: 222, userId: 3 }, user: { userId: 3 }, headers: {}, socket: {} };
  return runTransition(req, res, "close")
    .then(() => ({ res, odometerUpdates }))
    .finally(() => { db.execute = saved.execute; db.getConnection = saved.getConnection; });
}

test("a trip with the driver's end reading is closed without adding its distance again", async () => {
  const { res, odometerUpdates } = await closeWith({ endReading: true });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(odometerUpdates, []);
});

test("a trip without an end reading still adds the distance it drove, as before", async () => {
  const { res, odometerUpdates } = await closeWith({ endReading: false });
  assert.equal(res.statusCode, 200);
  assert.equal(odometerUpdates.length, 1);
  // two fixes ~11 km apart
  assert.ok(odometerUpdates[0][0] > 10 && odometerUpdates[0][0] < 12.5, String(odometerUpdates[0][0]));
  assert.equal(odometerUpdates[0][1], 77);
});
