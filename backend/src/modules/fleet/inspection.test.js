import "../../config/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import db from "../../config/db.js";
import {
  approveDeparture, CHECKLIST, createForDriver, markReviewed, readAnswers, resultOf, startGate,
  BLOCKED_MESSAGE, REQUIRED_MESSAGE,
} from "./inspection.service.js";
import { driverCreate } from "./inspection.controller.js";
import { startTrip } from "../driver-app/driver.controller.js";
import { ROLE_TEMPLATES } from "../../shared/rbac.js";
import { up as migrate060 } from "../../../migrations/060_pre_trip_inspections.js";

const DRIVER = { driverId: 9, companyId: 7, branchId: 111, name: "Juan Dela Cruz" };
const REF = "insp-0123456789abcdef";

const allOk = () => CHECKLIST.map((c) => ({ key: c.key, response: "ok" }));
const withProblem = (key, note = "Worn down to the wear bar") =>
  CHECKLIST.map((c) => ({ key: c.key, response: c.key === key ? "problem" : "ok", ...(c.key === key ? { note } : {}) }));

/**
 * A stand-in database: the company's rule, one released trip with a vehicle,
 * and whatever inspections and exceptions get written.
 */
function fakeDb({ required = true, status = "released", vehicleId = 77 } = {}) {
  const s = { required, status, vehicleId, inspections: [], items: [], photos: [], exceptions: [], settled: [], tripUpdates: 0 };
  const run = async (sql, params = []) => {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.includes("require_pre_trip_inspection AS required")) return [[{ required: s.required ? 1 : 0 }]];
    if (q.startsWith("SELECT vehicle_id FROM trip_assignments")) return [[s.vehicleId ? { vehicle_id: s.vehicleId } : undefined].filter(Boolean)];
    if (q.includes("FROM vehicle_inspections WHERE trip_ticket_id = ? AND vehicle_id = ?")) {
      return [s.inspections.filter((i) => i.vehicle_id === params[1]).map((i) => ({ id: i.id, result: i.result, approvedAt: i.approvedAt || null }))];
    }
    if (q.includes("FROM vehicle_inspections WHERE driver_id = ? AND client_ref = ?")) {
      const i = s.inspections.find((x) => x.driver_id === params[0] && x.client_ref === params[1]);
      return [i ? [{ id: i.id, result: i.result }] : []];
    }
    if (q.startsWith("SELECT inspection_id AS id") && q.includes("FROM vehicle_inspections WHERE inspection_id = ?")) {
      const i = s.inspections.find((x) => x.id === params[0]);
      return [i ? [{ id: i.id, result: i.result, reviewStatus: i.review_status }] : []];
    }
    if (q.includes("FROM trip_assignments ta JOIN trip_tickets tt") && q.includes("v.plate_no")) {
      return [[{ vehicle_id: s.vehicleId, status: s.status, branch_id: 222, plate_no: "ABC 1234" }]];
    }
    if (q.startsWith("INSERT INTO vehicle_inspections")) {
      const row = {
        id: s.inspections.length + 1, vehicle_id: params[3], driver_id: params[4], client_ref: params[5],
        result: params[7], ageS: params[11], review_status: params[12],
      };
      if (s.inspections.some((x) => x.driver_id === row.driver_id && x.client_ref === row.client_ref)) {
        throw Object.assign(new Error("dup"), { code: "ER_DUP_ENTRY" });
      }
      s.inspections.push(row);
      return [{ insertId: row.id }];
    }
    if (q.startsWith("INSERT INTO vehicle_inspection_items")) { s.items.push(params); return [{}]; }
    if (q.startsWith("INSERT INTO vehicle_inspection_photos")) { s.photos.push(params); return [{}]; }
    if (q.startsWith("INSERT INTO operational_exceptions")) { s.exceptions.push({ sql: q, params }); return [{}]; }
    if (q.startsWith("UPDATE operational_exceptions")) { s.settled.push(params); return [{}]; }
    if (q.includes("FROM vehicle_inspections i JOIN trip_tickets tt") && q.includes("FOR UPDATE")) {
      const i = s.inspections.find((x) => x.id === params[0]);
      return [i ? [{ inspection_id: i.id, result: i.result, departure_approved_at: i.approvedAt || null, trip_ticket_id: 55, driver_id: i.driver_id, branch_id: 222 }] : []];
    }
    if (q.startsWith("SELECT inspection_id, result, review_status FROM vehicle_inspections")) {
      const i = s.inspections.find((x) => x.id === params[0]);
      return [i ? [{ inspection_id: i.id, result: i.result, review_status: i.review_status }] : []];
    }
    if (q.startsWith("UPDATE vehicle_inspections SET departure_approved_by")) {
      const i = s.inspections.find((x) => x.id === params[4]);
      i.approvedAt = new Date(); i.review_status = "reviewed"; i.reason = params[1];
      return [{}];
    }
    if (q.startsWith("UPDATE vehicle_inspections SET review_status = 'reviewed'")) {
      const i = s.inspections.find((x) => x.id === params[2]);
      i.review_status = "reviewed";
      return [{}];
    }
    // the driver's Start
    if (q.includes("SELECT tt.status, tt.branch_id")) return [[{ status: s.status, branch_id: 222 }]];
    if (q.startsWith("UPDATE trip_tickets")) { s.tripUpdates += 1; s.status = params[0]; return [{}]; }
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

const submit = (input, files = []) => createForDriver({
  driver: DRIVER, tripId: 55, files,
  input: { clientRef: REF, confirmed: "true", answers: JSON.stringify(allOk()), ...input },
});

function photoFile() {
  const file = path.join(os.tmpdir(), `trackify-insp-${process.pid}-${Math.random().toString(36).slice(2)}.jpg`);
  fs.writeFileSync(file, "x");
  return { path: file, mimetype: "image/jpeg", size: 1 };
}
const gone = async (file) => {
  for (let i = 0; i < 20 && fs.existsSync(file); i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 10));
  }
  return !fs.existsSync(file);
};
const capture = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(v) { this.body = v; return this; } });

/* ---------------------------------------------------------------- */
/* The checklist and the answers                                    */
/* ---------------------------------------------------------------- */

test("the checklist has brakes, tyres and lights as critical, and fluids as not", () => {
  assert.deepEqual(CHECKLIST.filter((c) => c.critical).map((c) => c.key), ["brakes", "tyres", "lights"]);
  assert.deepEqual(CHECKLIST.filter((c) => !c.critical).map((c) => c.key), ["fluids"]);
});

test("every item must be answered once, and a problem must say what is wrong", () => {
  assert.throws(() => readAnswers(allOk().slice(1)), /Brakes is missing/);
  assert.throws(() => readAnswers([...allOk(), { key: "brakes", response: "ok" }]), /answered twice/);
  assert.throws(() => readAnswers([...allOk(), { key: "horn", response: "ok" }]), /not on the checklist/);
  assert.throws(() => readAnswers(withProblem("tyres", "")), /Tyres: say what is wrong/);
  assert.throws(() => readAnswers("not json"), /could not be read/);
  assert.throws(() => readAnswers(allOk().map((a) => ({ ...a, response: "maybe" }))), /OK, Problem or N\/A/);
});

test("a critical item cannot be skipped as N/A; a non-critical one can", () => {
  assert.throws(() => readAnswers(allOk().map((a) => (a.key === "lights" ? { ...a, response: "na" } : a))), /Lights must be checked/);
  const answers = readAnswers(allOk().map((a) => (a.key === "fluids" ? { ...a, response: "na" } : a)));
  assert.equal(resultOf(answers), "pass");
});

test("the result: any critical problem fails critically; another problem only flags", () => {
  assert.equal(resultOf(readAnswers(allOk())), "pass");
  assert.equal(resultOf(readAnswers(withProblem("fluids", "Small oil drip"))), "fail_noncritical");
  for (const key of ["brakes", "tyres", "lights"]) {
    assert.equal(resultOf(readAnswers(withProblem(key))), "fail_critical", key);
  }
});

/* ---------------------------------------------------------------- */
/* Filing one                                                       */
/* ---------------------------------------------------------------- */

test("a passing inspection is filed with every answer and raises nothing", async () => {
  const f = fakeDb();
  const restore = f.install();
  try {
    const { inspection, duplicate } = await submit({ ageMs: 120000 });
    assert.equal(duplicate, false);
    assert.equal(inspection.result, "pass");
    assert.equal(f.s.inspections[0].review_status, "not_needed");
    assert.equal(f.s.inspections[0].ageS, 120);
    assert.equal(f.s.items.length, CHECKLIST.length);
    // the wording is stored as it was asked
    assert.ok(f.s.items.some((p) => p[1] === "brakes" && p[2] === "Brakes" && p[3] === 1));
    assert.equal(f.s.exceptions.length, 0);
  } finally {
    restore();
  }
});

test("a critical problem needs its photo, and raises a critical exception for Fleet", async () => {
  const f = fakeDb();
  const restore = f.install();
  try {
    await assert.rejects(() => submit({ answers: JSON.stringify(withProblem("brakes")) }), /Brakes: add a photo/);

    const photo = photoFile();
    const { inspection } = await submit({ answers: JSON.stringify(withProblem("brakes", "Pedal goes to the floor")), photoItems: JSON.stringify(["brakes"]) }, [photo]);
    assert.equal(inspection.result, "fail_critical");
    assert.equal(f.s.inspections[0].review_status, "pending");
    assert.equal(f.s.photos.length, 1);
    assert.equal(f.s.photos[0][1], "brakes");
    const ex = f.s.exceptions[0];
    assert.match(ex.sql, /'inspection'/);
    assert.equal(ex.params[4], "vehicle_inspection_failed");
    assert.equal(ex.params[5], "critical");
    assert.match(ex.params[6], /Pre-trip inspection failed \(ABC 1234\): Brakes/);
    assert.match(ex.params[7], /Pedal goes to the floor/);
    fs.unlinkSync(photo.path);
  } finally {
    restore();
  }
});

test("a non-critical problem is a warning for Fleet, not a block", async () => {
  const f = fakeDb();
  const restore = f.install();
  try {
    const photo = photoFile();
    const { inspection } = await submit({ answers: JSON.stringify(withProblem("fluids", "Coolant low")), photoItems: JSON.stringify(["fluids"]) }, [photo]);
    assert.equal(inspection.result, "fail_noncritical");
    assert.equal(f.s.exceptions[0].params[4], "vehicle_inspection_issue");
    assert.equal(f.s.exceptions[0].params[5], "warning");
    assert.equal(await startGate({ execute: f.run }, { companyId: 7, tripId: 55 }), null);
    fs.unlinkSync(photo.path);
  } finally {
    restore();
  }
});

test("sent again with the same reference, it is filed once", async () => {
  const f = fakeDb();
  const restore = f.install();
  try {
    await submit({});
    const again = await submit({});
    assert.equal(again.duplicate, true);
    assert.equal(f.s.inspections.length, 1);
  } finally {
    restore();
  }
});

test("it must be confirmed, carry its reference, and come before the trip starts", async () => {
  const f = fakeDb();
  const restore = f.install();
  try {
    await assert.rejects(() => submit({ confirmed: "false" }), /Confirm that you checked/);
    await assert.rejects(() => submit({ clientRef: "" }), /missing its reference/);
    f.s.status = "in_transit";
    await assert.rejects(() => submit({}), (e) => e.status === 409 && /before the trip starts/.test(e.message));
    assert.equal(f.s.inspections.length, 0);
  } finally {
    restore();
  }
});

test("once a critical item failed, no new inspection replaces Fleet's decision", async () => {
  const f = fakeDb();
  f.s.inspections.push({ id: 1, vehicle_id: 77, driver_id: 9, client_ref: "insp-earlier-000001", result: "fail_critical", review_status: "pending" });
  const restore = f.install();
  try {
    await assert.rejects(() => submit({}), (e) => e.status === 409 && e.code === "inspection_failed");
    assert.equal(f.s.inspections.length, 1);
  } finally {
    restore();
  }
});

/* ---------------------------------------------------------------- */
/* The Start gate                                                   */
/* ---------------------------------------------------------------- */

test("with the rule off, a trip starts exactly as before", async () => {
  const f = fakeDb({ required: false });
  assert.equal(await startGate({ execute: f.run }, { companyId: 7, tripId: 55 }), null);
});

test("with the rule on: no inspection, no start; a pass starts; a critical failure holds until Fleet approves", async () => {
  const f = fakeDb();
  assert.deepEqual(await startGate({ execute: f.run }, { companyId: 7, tripId: 55 }), { code: "inspection_required", message: REQUIRED_MESSAGE });

  f.s.inspections.push({ id: 1, vehicle_id: 77, driver_id: 9, result: "fail_critical" });
  assert.deepEqual(await startGate({ execute: f.run }, { companyId: 7, tripId: 55 }), { code: "inspection_failed", message: BLOCKED_MESSAGE });

  f.s.inspections[0].approvedAt = new Date();
  assert.equal(await startGate({ execute: f.run }, { companyId: 7, tripId: 55 }), null);
});

test("a vehicle swapped onto the trip needs its own inspection", async () => {
  const f = fakeDb();
  f.s.inspections.push({ id: 1, vehicle_id: 77, driver_id: 9, result: "pass" });
  assert.equal(await startGate({ execute: f.run }, { companyId: 7, tripId: 55 }), null);
  f.s.vehicleId = 78;
  assert.equal((await startGate({ execute: f.run }, { companyId: 7, tripId: 55 })).code, "inspection_required");
});

test("the driver's Start is refused while the inspection holds it, and goes once it passes", async () => {
  const f = fakeDb();
  const restore = f.install();
  const req = { params: { id: "55" }, body: {}, driver: DRIVER, context: {}, user: {}, headers: {}, socket: {} };
  try {
    let res = capture();
    await startTrip(req, res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, "inspection_required");
    assert.equal(f.s.tripUpdates, 0);

    f.s.inspections.push({ id: 1, vehicle_id: 77, driver_id: 9, result: "pass" });
    res = capture();
    await startTrip(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.status, "in_transit");
    assert.equal(f.s.tripUpdates, 1);
  } finally {
    restore();
  }
});

test("the office's Start is held by the same rule", async () => {
  const source = fs.readFileSync(new URL("../operations/trip-status.service.js", import.meta.url), "utf8");
  assert.match(source, /if \(key === "start"\) \{\s*const gate = await startGate\(conn, \{ companyId, tripId \}\);/);
});

/* ---------------------------------------------------------------- */
/* Fleet                                                            */
/* ---------------------------------------------------------------- */

test("Fleet approves departure with a reason; it settles the exception and lets the trip go", async () => {
  const f = fakeDb();
  f.s.inspections.push({ id: 1, vehicle_id: 77, driver_id: 9, result: "fail_critical", review_status: "pending" });
  const restore = f.install();
  try {
    await assert.rejects(() => approveDeparture({ companyId: 7, id: 1, userId: 3, reason: "ok" }), /Give the reason/);
    const done = await approveDeparture({ companyId: 7, id: 1, userId: 3, reason: "Brake line replaced and tested" });
    assert.equal(done.driverId, 9);
    assert.equal(f.s.inspections[0].reason, "Brake line replaced and tested");
    assert.match(f.s.settled[0][1], /Departure approved: Brake line replaced/);
    assert.equal(await startGate({ execute: f.run }, { companyId: 7, tripId: 55 }), null);
    await assert.rejects(() => approveDeparture({ companyId: 7, id: 1, userId: 3, reason: "Again, twice" }), /already approved/);
  } finally {
    restore();
  }
});

test("only a critical failure needs departure approved; a warning is reviewed instead", async () => {
  const f = fakeDb();
  f.s.inspections.push({ id: 1, vehicle_id: 77, driver_id: 9, result: "fail_noncritical", review_status: "pending" });
  const restore = f.install();
  try {
    await assert.rejects(() => approveDeparture({ companyId: 7, id: 1, userId: 3, reason: "Not needed here" }), /Only a failed critical/);
    await markReviewed({ companyId: 7, id: 1, userId: 3, note: "Coolant topped up" });
    assert.equal(f.s.inspections[0].review_status, "reviewed");
    await assert.rejects(() => markReviewed({ companyId: 7, id: 1, userId: 3 }), /no review waiting/);
  } finally {
    restore();
  }
});

test("the Fleet Manager role may read and review inspections; dispatch and branch managers may read", () => {
  const perms = (name) => ROLE_TEMPLATES.find((t) => t.name === name).permissions;
  assert.ok(perms("Fleet Manager").includes("inspection.read"));
  assert.ok(perms("Fleet Manager").includes("inspection.review"));
  assert.ok(perms("Dispatcher / Operations Coordinator").includes("inspection.read"));
  assert.ok(!perms("Dispatcher / Operations Coordinator").includes("inspection.review"));
  assert.ok(perms("Branch Manager").includes("inspection.read"));
  assert.ok(perms("Company Administrator").includes("inspection.review"));
  assert.ok(!perms("Driver").includes("inspection.review"));
});

test("Fleet's routes are behind the inspection permissions", () => {
  const routes = fs.readFileSync(new URL("./fleet.routes.js", import.meta.url), "utf8");
  for (const [method, p, perm] of [
    ["get", "/inspections", "inspection.read"],
    ["get", "/inspections/:id", "inspection.read"],
    ["get", "/inspections/:id/photos/:photoId", "inspection.read"],
    ["post", "/inspections/:id/approve-departure", "inspection.review"],
    ["post", "/inspections/:id/review", "inspection.review"],
  ]) {
    assert.ok(routes.includes(`router.${method}("${p}", requirePermission("${perm}")`), `${method} ${p}`);
  }
});

/* ---------------------------------------------------------------- */
/* The controller keeps no orphan photos                            */
/* ---------------------------------------------------------------- */

test("photos are removed when the inspection is refused, or was already filed", async () => {
  const f = fakeDb();
  const restore = f.install();
  try {
    const refused = photoFile();
    let res = capture();
    await driverCreate({ params: { id: "55" }, driver: DRIVER, body: { clientRef: REF, confirmed: "false", answers: JSON.stringify(allOk()), photoItems: JSON.stringify(["fluids"]) }, files: [refused], headers: {}, socket: {} }, res);
    assert.equal(res.statusCode, 400);
    assert.ok(await gone(refused.path));

    res = capture();
    await driverCreate({ params: { id: "55" }, driver: DRIVER, body: { clientRef: REF, confirmed: "true", answers: JSON.stringify(allOk()) }, files: [], headers: {}, socket: {} }, res);
    assert.equal(res.statusCode, 201);

    const copy = photoFile();
    res = capture();
    await driverCreate({ params: { id: "55" }, driver: DRIVER, body: { clientRef: REF, confirmed: "true", answers: JSON.stringify(allOk()), photoItems: JSON.stringify(["fluids"]) }, files: [copy], headers: {}, socket: {} }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.duplicate, true);
    assert.ok(await gone(copy.path));
  } finally {
    restore();
  }
});

/* ---------------------------------------------------------------- */
/* Migration 060                                                    */
/* ---------------------------------------------------------------- */

test("060 only adds, and run twice changes nothing", async () => {
  const statements = [];
  const columns = new Set();
  let sourceKind = "enum('pause','support')";
  const conn = {
    async query(sql, params = []) {
      const q = sql.replace(/\s+/g, " ").trim();
      statements.push(q);
      if (q.includes("information_schema.COLUMNS") && q.includes("COLUMN_TYPE")) return [[{ type: sourceKind }]];
      if (q.includes("information_schema.COLUMNS")) return [columns.has(params[1]) ? [{ COLUMN_NAME: params[1] }] : []];
      if (q.startsWith("ALTER TABLE company_settings ADD COLUMN")) columns.add("require_pre_trip_inspection");
      if (q.startsWith("ALTER TABLE operational_exceptions MODIFY")) sourceKind = "enum('pause','support','inspection')";
      if (q.startsWith("SELECT company_id FROM companies")) return [[]];
      return [[]];
    },
  };
  await migrate060(conn);
  const first = statements.filter((q) => /^(ALTER|DROP)/.test(q));
  assert.equal(first.length, 2);
  assert.ok(statements.filter((q) => q.startsWith("CREATE TABLE")).every((q) => q.startsWith("CREATE TABLE IF NOT EXISTS")));
  assert.ok(!statements.some((q) => /^DROP|DELETE FROM/.test(q)));
  assert.ok(first.some((q) => /require_pre_trip_inspection TINYINT\(1\) NOT NULL DEFAULT 0/.test(q)), "off by default");

  statements.length = 0;
  await migrate060(conn);
  assert.equal(statements.filter((q) => /^ALTER/.test(q)).length, 0);
});

test("the driver's inspection is audited under the trip's branch", async () => {
  const f = fakeDb();
  const restore = f.install();
  const audits = [];
  const inner = db.execute;
  db.execute = async (sql, params) => {
    if (/INSERT INTO audit_logs/.test(sql)) audits.push(params);
    return inner(sql, params);
  };
  try {
    const res = capture();
    const req = { params: { id: "55" }, driver: DRIVER, body: { clientRef: "insp-audit-0000001", confirmed: "true", answers: JSON.stringify(allOk()) }, files: [], headers: {}, socket: {} };
    await driverCreate(req, res);
    assert.equal(res.statusCode, 201);
    assert.equal(req.context.branchId, 222);
    assert.equal(audits.length, 1);
    assert.equal(audits[0][1], 222);
  } finally {
    restore();
  }
});

test("the simplified form: one description and untagged photos for a report covering several items", async () => {
  const f = fakeDb();
  const restore = f.install();
  try {
    const photo = photoFile();
    const answers = CHECKLIST.map((c) => (
      c.key === "tyres" || c.key === "fluids"
        ? { key: c.key, response: "problem", note: "Front left tyre flat; oil dripping" }
        : { key: c.key, response: "ok" }
    ));
    const { inspection } = await createForDriver({
      driver: DRIVER, tripId: 55, files: [photo],
      input: { clientRef: "insp-simplified-0001", confirmed: "true", answers: JSON.stringify(answers) },
    });
    assert.equal(inspection.result, "fail_critical");
    assert.equal(f.s.photos.length, 1);
    assert.equal(f.s.photos[0][1], null, "a photo of the whole report has no item");
    assert.equal(f.s.exceptions.length, 1);
    fs.unlinkSync(photo.path);
  } finally {
    restore();
  }
});
