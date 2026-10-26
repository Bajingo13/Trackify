import "../../config/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import db from "../../config/db.js";
import {
  actualKm, correctReading, createForDriver, odometerGate, readKm, END_REQUIRED, START_REQUIRED, MAX_TRIP_KM,
} from "./odometer.service.js";
import { deliverTrip, startTrip } from "../driver-app/driver.controller.js";
import { up as migrate061 } from "../../../migrations/061_odometer_readings.js";

const DRIVER = { driverId: 9, companyId: 7, branchId: 111, name: "Juan Dela Cruz" };
let refs = 0;
const ref = () => `odo-0000000000-${(refs += 1)}`;

/** A stand-in database: one trip, its readings, the vehicle's odometer, and the company's rule. */
function fakeDb({ required = true, status = "released", vehicleOdometer = 120000 } = {}) {
  const s = { required, status, vehicleOdometer, readings: [], tripUpdates: 0, inspectionRequired: false };
  const row = (r) => ({ reading_id: r.id, kind: r.kind, value_km: r.value, corrected_value_km: r.corrected ?? null, captured_at: new Date(), photo_path: r.photo || null, corrected_at: null, correction_reason: null });
  const run = async (sql, params = []) => {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.includes("require_odometer AS required")) return [[{ required: s.required ? 1 : 0 }]];
    if (q.includes("require_pre_trip_inspection AS required")) return [[{ required: 0 }]];
    if (q.includes("FROM trip_odometer_readings WHERE trip_ticket_id = ?")) return [s.readings.map(row)];
    if (q.includes("FROM trip_odometer_readings WHERE driver_id = ? AND client_ref = ?")) {
      const r = s.readings.find((x) => x.driver === params[0] && x.ref === params[1]);
      return [r ? [row(r)] : []];
    }
    if (q.includes("FROM trip_odometer_readings WHERE reading_id = ?") && !q.includes("FOR UPDATE")) {
      const r = s.readings.find((x) => x.id === params[0]);
      return [r ? [row(r)] : []];
    }
    if (q.includes("FROM trip_odometer_readings WHERE reading_id = ? AND company_id = ? FOR UPDATE")) {
      const r = s.readings.find((x) => x.id === params[0]);
      return [r ? [{ reading_id: r.id, trip_ticket_id: 55, vehicle_id: 77, kind: r.kind, value_km: r.value, corrected_value_km: r.corrected ?? null }] : []];
    }
    if (q.includes("FROM trip_assignments ta JOIN trip_tickets tt") && q.includes("v.odometer")) {
      return [[{ vehicle_id: 77, status: s.status, branch_id: 222, odometer: s.vehicleOdometer }]];
    }
    if (q.startsWith("INSERT INTO trip_odometer_readings")) {
      if (s.readings.some((x) => x.kind === params[5])) throw Object.assign(new Error("dup kind"), { code: "ER_DUP_ENTRY" });
      const r = { id: s.readings.length + 1, driver: params[4], kind: params[5], value: params[6], ref: params[7], photo: params[8] };
      s.readings.push(r);
      return [{ insertId: r.id }];
    }
    if (q.startsWith("UPDATE vehicles SET odometer = ?")) {
      const [value, , , v2, v3, limit] = params;
      const cur = s.vehicleOdometer;
      if (cur == null || cur === 0 || (v2 > cur && v3 - cur <= limit)) s.vehicleOdometer = value;
      return [{}];
    }
    if (q.startsWith("UPDATE trip_odometer_readings SET corrected_value_km")) {
      const r = s.readings.find((x) => x.id === params[3]);
      r.corrected = params[0];
      return [{}];
    }
    if (q.includes("SELECT tt.status, tt.branch_id")) return [[{ status: s.status, branch_id: 222 }]];
    if (q.startsWith("SELECT vehicle_id FROM trip_assignments")) return [[{ vehicle_id: 77 }]];
    if (q.startsWith("UPDATE trip_tickets")) { s.tripUpdates += 1; s.status = params[0]; return [{}]; }
    if (q.includes("FROM trip_pod")) return [[]];
    if (/^(INSERT|UPDATE|DELETE)/.test(q)) return [{}];
    return [[]];
  };
  const install = () => {
    const saved = { execute: db.execute, getConnection: db.getConnection };
    db.execute = run;
    db.getConnection = async () => ({ beginTransaction: async () => {}, execute: run, commit: async () => {}, rollback: async () => {}, release() {} });
    return () => { db.execute = saved.execute; db.getConnection = saved.getConnection; };
  };
  return { s, run, install };
}

const record = (kind, valueKm, extra = {}) =>
  createForDriver({ driver: DRIVER, tripId: 55, input: { kind, valueKm, clientRef: ref(), ...extra } });

const capture = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(v) { this.body = v; return this; } });
const req = (extra = {}) => ({ params: { id: "55" }, body: {}, driver: DRIVER, context: {}, user: {}, headers: {}, socket: {}, ...extra });

/* ---------------------------------------------------------------- */

test("a reading is kilometres, as numbers, to one decimal", () => {
  assert.equal(readKm("123456"), 123456);
  assert.equal(readKm("123,456.78"), 123456.8);
  assert.equal(readKm(" 98765.4 "), 98765.4);
  for (const bad of ["", "abc", "-5", "12km", "1e5", "99999999"]) assert.equal(readKm(bad), null, bad);
});

test("the distance driven comes from the corrected figures, and only once both exist", () => {
  assert.equal(actualKm({ start: { effectiveKm: 1000 }, end: { effectiveKm: 1250.5 } }), 250.5);
  assert.equal(actualKm({ start: { effectiveKm: 1000 }, end: null }), null);
  assert.equal(actualKm({ start: null, end: { effectiveKm: 1000 } }), null);
});

test("the start reading is taken before Start, and moves the vehicle's odometer forward", async () => {
  const f = fakeDb();
  const restore = f.install();
  try {
    const { reading, warning } = await record("start", "120150");
    assert.equal(reading.kind, "start");
    assert.equal(reading.valueKm, 120150);
    assert.equal(warning, null);
    assert.equal(f.s.vehicleOdometer, 120150);
  } finally {
    restore();
  }
});

test("a figure lower than the vehicle's record is saved with a warning, and never winds it back", async () => {
  const f = fakeDb();
  const restore = f.install();
  try {
    const { reading, warning } = await record("start", "119000");
    assert.equal(reading.valueKm, 119000);
    assert.match(warning, /Lower than the last figure on record/);
    assert.equal(f.s.vehicleOdometer, 120000);
  } finally {
    restore();
  }
});

test("a figure typed with an extra digit does not inflate the vehicle's odometer", async () => {
  const f = fakeDb();
  const restore = f.install();
  try {
    await record("start", "1201500");
    assert.equal(f.s.vehicleOdometer, 120000);
  } finally {
    restore();
  }
});

test("the end reading must be at least the start, and within one trip of it", async () => {
  const f = fakeDb();
  const restore = f.install();
  try {
    await record("start", "120150");
    f.s.status = "in_transit";
    await assert.rejects(() => record("end", "120100"), /lower than the start reading/);
    await assert.rejects(() => record("end", String(120150 + MAX_TRIP_KM + 1)), /more than/);
    const { reading } = await record("end", "120400");
    assert.equal(reading.valueKm, 120400);
    assert.equal(f.s.vehicleOdometer, 120400);
  } finally {
    restore();
  }
});

test("each reading is taken once, at its moment", async () => {
  const f = fakeDb();
  const restore = f.install();
  try {
    await assert.rejects(() => record("end", "120400"), /taken on the road/);
    await record("start", "120150");
    await assert.rejects(() => record("start", "120160"), (e) => e.status === 409 && e.code === "odometer_recorded");
    f.s.status = "delivered";
    await assert.rejects(() => record("end", "120400"), /taken on the road/);
  } finally {
    restore();
  }
});

test("sent again with the same reference, it is recorded once", async () => {
  const f = fakeDb();
  const restore = f.install();
  try {
    const input = { kind: "start", valueKm: "120150", clientRef: "odo-same-reference-01" };
    await createForDriver({ driver: DRIVER, tripId: 55, input });
    const again = await createForDriver({ driver: DRIVER, tripId: 55, input });
    assert.equal(again.duplicate, true);
    assert.equal(f.s.readings.length, 1);
  } finally {
    restore();
  }
});

test("it must say which reading, and carry a number and a reference", async () => {
  const f = fakeDb();
  const restore = f.install();
  try {
    await assert.rejects(() => record("middle", "1"), /start or the end/);
    await assert.rejects(() => record("start", "lots"), /numbers only/);
    await assert.rejects(() => createForDriver({ driver: DRIVER, tripId: 55, input: { kind: "start", valueKm: "1" } }), /reference/);
  } finally {
    restore();
  }
});

/* ---------------------------------------------------------------- */
/* The gates on the driver's own steps                              */
/* ---------------------------------------------------------------- */

test("with the rule off, Start and delivery go as before", async () => {
  const f = fakeDb({ required: false });
  assert.equal(await odometerGate({ execute: f.run }, { companyId: 7, tripId: 55, to: "in_transit" }), null);
  assert.equal(await odometerGate({ execute: f.run }, { companyId: 7, tripId: 55, to: "delivered" }), null);
});

test("with the rule on, Start waits for the start reading and delivery for the end one", async () => {
  const f = fakeDb();
  const gate = (to) => odometerGate({ execute: f.run }, { companyId: 7, tripId: 55, to });
  assert.deepEqual(await gate("in_transit"), { code: "odometer_required", message: START_REQUIRED });
  f.s.readings.push({ id: 1, kind: "start", value: 120150 });
  assert.equal(await gate("in_transit"), null);
  assert.deepEqual(await gate("delivered"), { code: "odometer_required", message: END_REQUIRED });
  f.s.readings.push({ id: 2, kind: "end", value: 120400 });
  assert.equal(await gate("delivered"), null);
});

test("the driver's Start is refused without the start reading, and goes with it", async () => {
  const f = fakeDb();
  const restore = f.install();
  try {
    let res = capture();
    await startTrip(req(), res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, "odometer_required");
    assert.equal(f.s.tripUpdates, 0);

    f.s.readings.push({ id: 1, kind: "start", value: 120150 });
    res = capture();
    await startTrip(req(), res);
    assert.equal(res.statusCode, 200);
    assert.equal(f.s.tripUpdates, 1);
  } finally {
    restore();
  }
});

test("delivery is refused without the end reading, and its photo is not kept", async () => {
  const f = fakeDb({ status: "in_transit" });
  const restore = f.install();
  const os = await import("node:os");
  const path = await import("node:path");
  const file = path.join(os.tmpdir(), `trackify-pod-odo-${process.pid}.jpg`);
  fs.writeFileSync(file, "x");
  try {
    const res = capture();
    await deliverTrip(req({ body: { receivedBy: "Ana Reyes" }, file: { path: file, mimetype: "image/jpeg", size: 1 } }), res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, "odometer_required");
    assert.equal(f.s.tripUpdates, 0);
    for (let i = 0; i < 20 && fs.existsSync(file); i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(fs.existsSync(file), false);
  } finally {
    restore();
  }
});

test("the office's own Start and close are not held by the odometer", () => {
  const source = fs.readFileSync(new URL("../operations/trip-status.service.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /odometerGate/);
});

/* ---------------------------------------------------------------- */
/* Fleet corrections                                                */
/* ---------------------------------------------------------------- */

test("Fleet corrects a reading with a reason; the driver's figure is kept", async () => {
  const f = fakeDb();
  f.s.readings.push({ id: 1, kind: "start", value: 12015 }, { id: 2, kind: "end", value: 120400 });
  const restore = f.install();
  try {
    await assert.rejects(() => correctReading({ companyId: 7, id: 1, userId: 3, valueKm: "120150", reason: "typo" }), /reason/);
    const done = await correctReading({ companyId: 7, id: 1, userId: 3, valueKm: "120150", reason: "Driver missed a digit; photo shows 120150" });
    assert.deepEqual(done, { tripId: 55, kind: "start", from: 12015, to: 120150 });
    assert.equal(f.s.readings[0].value, 12015, "the driver's figure stays");
    assert.equal(f.s.readings[0].corrected, 120150);
  } finally {
    restore();
  }
});

test("a correction that would leave the pair impossible is refused", async () => {
  const f = fakeDb();
  f.s.readings.push({ id: 1, kind: "start", value: 120150 }, { id: 2, kind: "end", value: 120400 });
  const restore = f.install();
  try {
    await assert.rejects(() => correctReading({ companyId: 7, id: 2, userId: 3, valueKm: "120000", reason: "Checked the photo" }), /lower than the start/);
    await assert.rejects(() => correctReading({ companyId: 7, id: 404, userId: 3, valueKm: "1", reason: "Checked the photo" }), /not found/);
  } finally {
    restore();
  }
});

test("corrections need vehicle.manage; reading needs vehicle.read", () => {
  const routes = fs.readFileSync(new URL("./fleet.routes.js", import.meta.url), "utf8");
  assert.ok(routes.includes('router.post("/odometer-readings/:id/correct", requirePermission("vehicle.manage")'));
  assert.ok(routes.includes('router.get("/trips/:id/odometer", requirePermission("vehicle.read")'));
  assert.ok(routes.includes('router.get("/odometer-readings/:id/photo", requirePermission("vehicle.read")'));
});

test("061 only adds, the rule off by default, and run twice changes nothing", async () => {
  const statements = [];
  const columns = new Set();
  const conn = {
    async query(sql, params = []) {
      const q = sql.replace(/\s+/g, " ").trim();
      statements.push(q);
      if (q.includes("information_schema.COLUMNS")) return [columns.has(params[1]) ? [{ COLUMN_NAME: params[1] }] : []];
      if (q.startsWith("ALTER TABLE company_settings ADD COLUMN require_odometer")) columns.add("require_odometer");
      return [[]];
    },
  };
  await migrate061(conn);
  assert.ok(statements.some((q) => q.startsWith("CREATE TABLE IF NOT EXISTS trip_odometer_readings")));
  assert.ok(statements.some((q) => /UNIQUE KEY uq_odometer_trip_kind \(trip_ticket_id, kind\)/.test(q)));
  assert.ok(statements.some((q) => /require_odometer TINYINT\(1\) NOT NULL DEFAULT 0/.test(q)));
  assert.ok(!statements.some((q) => /^DROP|DELETE FROM/.test(q)));
  statements.length = 0;
  await migrate061(conn);
  assert.equal(statements.filter((q) => q.startsWith("ALTER")).length, 0);
});
