import "../../config/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import db from "../../config/db.js";
import { createForDriver, readReport, settleOnDelivery, REASONS } from "./deliveryReports.service.js";
import { driverCreate } from "./deliveryReports.controller.js";
import { createForDriver as requestPause } from "../support/pause.service.js";
import { deliverTrip } from "../driver-app/driver.controller.js";
import { up as migrate063 } from "../../../migrations/063_delivery_reports.js";

const DRIVER = { driverId: 9, companyId: 7, branchId: 111, name: "Juan Dela Cruz" };
const REF = "dlvr-0123456789abcdef";

/**
 * A stand-in database: one trip assigned to the driver, its pause and POD, and
 * whatever reports, photos, exceptions and timeline lines get written.
 */
function fakeDb({ status = "in_transit", pause = null, pod = true, missingTable = false } = {}) {
  const s = { status, pause, pod, reports: [], photos: [], exceptions: [], settled: [], history: [], resolved: [] };
  const noTable = () => { throw Object.assign(new Error("no table"), { code: "ER_NO_SUCH_TABLE" }); };
  const row = (r) => (r ? { id: r.id, tripId: 55, outcome: r.outcome, reason: r.reason, status: r.status, qtyExpected: r.qtyExpected, qtyDelivered: r.qtyDelivered } : undefined);
  const run = async (sql, params = []) => {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.includes("FROM delivery_reports WHERE driver_id = ? AND client_ref = ?")) {
      if (missingTable) noTable();
      return [[row(s.reports.find((r) => r.driverId === params[0] && r.clientRef === params[1]))].filter(Boolean)];
    }
    if (q.includes("FROM delivery_reports WHERE report_id = ?")) return [[row(s.reports.find((r) => r.id === params[0]))].filter(Boolean)];
    if (q.includes("FROM delivery_reports WHERE trip_ticket_id = ? AND outcome = 'not_delivered' AND status = 'open'")) {
      if (missingTable) noTable();
      return [[row(s.reports.filter((r) => r.outcome === "not_delivered" && r.status === "open").at(-1))].filter(Boolean)];
    }
    if (q.startsWith("SELECT report_id AS id FROM delivery_reports WHERE trip_ticket_id = ?")) {
      if (missingTable) noTable();
      return [s.reports.filter((r) => r.outcome === "not_delivered" && ["open", "reattempt"].includes(r.status)).map((r) => ({ id: r.id }))];
    }
    if (q.includes("FROM trip_assignments ta JOIN trip_tickets tt") && q.includes("FOR UPDATE")) {
      return [[{ id: 55, status: s.status, branchId: 222, ticketNo: "TT-0055" }]];
    }
    if (q.startsWith("SELECT status FROM trip_pauses")) return [[s.pause].filter(Boolean)];
    if (q.startsWith("SELECT 1 AS ok FROM trip_pod")) return [[s.pod ? { ok: 1 } : undefined].filter(Boolean)];
    if (q.startsWith("INSERT INTO delivery_reports")) {
      const r = {
        id: s.reports.length + 1, branchId: params[1], driverId: params[3], clientRef: params[4], outcome: params[5], reason: params[6],
        qtyExpected: params[7], qtyDelivered: params[8], note: params[9], lat: params[10], lng: params[11], ageS: params[12], status: "open",
      };
      if (s.reports.some((x) => x.driverId === r.driverId && x.clientRef === r.clientRef)) {
        throw Object.assign(new Error("dup"), { code: "ER_DUP_ENTRY" });
      }
      s.reports.push(r);
      return [{ insertId: r.id }];
    }
    if (q.startsWith("INSERT INTO delivery_report_photos")) { s.photos.push(params); return [{}]; }
    if (q.startsWith("INSERT INTO operational_exceptions")) { s.exceptions.push({ sql: q, params }); return [{}]; }
    if (q.startsWith("UPDATE operational_exceptions")) { s.settled.push(params); return [{}]; }
    if (q.startsWith("INSERT INTO trip_status_history")) { s.history.push(params); return [{}]; }
    if (q.startsWith("UPDATE delivery_reports SET status = 'resolved'")) {
      const r = s.reports.find((x) => x.id === params[2]);
      r.status = "resolved"; s.resolved.push(params);
      return [{}];
    }
    // the pause request
    if (q.startsWith("SELECT pause_id AS id, status FROM trip_pauses")) return [[s.pause].filter(Boolean)];
    if (q.includes("FROM trip_assignments ta JOIN trip_tickets tt")) return [[{ id: 55, branchId: 222, status: s.status, tripNo: "TT-0055" }]];
    if (/^(INSERT|UPDATE|DELETE)/.test(q)) return [{ insertId: 1 }];
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

const notDelivered = (extra = {}) => ({ clientRef: REF, outcome: "not_delivered", reason: "absent", note: "Warehouse closed, nobody answering", lat: "7.07", lng: "125.61", ...extra });
const short = (extra = {}) => ({ clientRef: REF, outcome: "delivered_with_issue", reason: "short", note: "Two crates missing", qtyExpected: "10", qtyDelivered: "8", ...extra });

function photoFile() {
  const file = path.join(os.tmpdir(), `trackify-dlvr-${process.pid}-${Math.random().toString(36).slice(2)}.jpg`);
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
/* What the phone sends                                             */
/* ---------------------------------------------------------------- */

test("each reason belongs to one outcome", () => {
  assert.deepEqual(Object.keys(REASONS).filter((k) => REASONS[k].outcome === "delivered_with_issue"), ["short", "damaged", "wrong_item"]);
  assert.deepEqual(Object.keys(REASONS).filter((k) => REASONS[k].outcome === "not_delivered"), ["refused", "absent", "wrong_address", "other"]);
  assert.throws(() => readReport({ outcome: "not_delivered", reason: "short", note: "abc" }), /Choose what went wrong/);
  assert.throws(() => readReport({ outcome: "lost", reason: "absent", note: "abc" }), /Say whether the load was delivered/);
});

test("a report says what happened", () => {
  assert.throws(() => readReport(notDelivered({ note: " " })), /Say what happened/);
  assert.throws(() => readReport(notDelivered({ note: "x".repeat(1001) })), /under 1000/);
  assert.equal(readReport(notDelivered()).note, "Warehouse closed, nobody answering");
});

test("short and damaged need a photo; the others do not", () => {
  assert.throws(() => readReport(short(), 0), /Short delivery: add a photo/);
  assert.throws(() => readReport({ outcome: "delivered_with_issue", reason: "damaged", note: "Crushed box" }, 0), /Damaged goods: add a photo/);
  assert.doesNotThrow(() => readReport({ outcome: "delivered_with_issue", reason: "wrong_item", note: "Wrong SKU" }, 0));
  assert.doesNotThrow(() => readReport(notDelivered({ reason: "refused" }), 0));
});

test("a short delivery gives both counts, with fewer delivered than expected", () => {
  assert.throws(() => readReport(short({ qtyExpected: "" }), 1), /how many were expected/);
  assert.throws(() => readReport(short({ qtyDelivered: "abc" }), 1), /how many were delivered/);
  assert.throws(() => readReport(short({ qtyDelivered: "10" }), 1), /fewer delivered than expected/);
  assert.throws(() => readReport(short({ qtyExpected: "-1" }), 1), /how many were expected/);
  const r = readReport(short(), 1);
  assert.equal(r.qtyExpected, 10);
  assert.equal(r.qtyDelivered, 8);
  // counts only mean something for a short delivery
  assert.equal(readReport(notDelivered({ qtyExpected: "5", qtyDelivered: "1" })).qtyExpected, null);
});

test("the position is kept only when it is a real one, and the age is clamped", () => {
  const r = readReport(notDelivered({ lat: "95", lng: "", ageMs: String(-5) }));
  assert.equal(r.lat, null);
  assert.equal(r.lng, null);
  assert.equal(r.ageS, 0);
  assert.equal(readReport(notDelivered({ ageMs: String(10 * 24 * 3600 * 1000) })).ageS, 48 * 3600);
});

/* ---------------------------------------------------------------- */
/* Not delivered                                                    */
/* ---------------------------------------------------------------- */

test("not delivered: filed on the road as a critical failed delivery, with a timeline line, and the trip left as it is", async () => {
  const f = fakeDb();
  const restore = f.install();
  try {
    const { report, duplicate } = await createForDriver({ driver: DRIVER, tripId: 55, input: notDelivered(), files: [photoFile()] });
    assert.equal(duplicate, false);
    assert.equal(report.outcome, "not_delivered");
    assert.equal(report.reasonLabel, "Receiver absent or closed");
    assert.equal(f.s.reports[0].lat, 7.07);
    assert.equal(f.s.photos.length, 1);
    assert.equal(f.s.exceptions.length, 1);
    const p = f.s.exceptions[0].params;
    assert.equal(p[3], 1); // source_id: the report
    assert.equal(p[4], "failed_delivery");
    assert.equal(p[5], "critical");
    assert.match(p[6], /^Not delivered: Receiver absent or closed/);
    assert.match(f.s.exceptions[0].sql, /'delivery_report'/);
    assert.equal(f.s.history[0][5], "DELIVERY_NOT_COMPLETED");
    assert.equal(f.s.status, "in_transit");
  } finally { restore(); }
});

test("not delivered is refused off the road, alongside a pause, or twice", async () => {
  for (const [opts, code, message] of [
    [{ status: "released" }, undefined, /while the trip is on the road/],
    [{ pause: { status: "pending" } }, "pause_open", /pause open/],
  ]) {
    const f = fakeDb(opts);
    const restore = f.install();
    try {
      await assert.rejects(createForDriver({ driver: DRIVER, tripId: 55, input: notDelivered() }), (e) => e.status === 409 && e.code === code && message.test(e.message));
      assert.equal(f.s.reports.length, 0);
    } finally { restore(); }
  }
  const f = fakeDb();
  const restore = f.install();
  try {
    await createForDriver({ driver: DRIVER, tripId: 55, input: notDelivered() });
    await assert.rejects(
      createForDriver({ driver: DRIVER, tripId: 55, input: notDelivered({ clientRef: "dlvr-second-attempt-01" }) }),
      (e) => e.status === 409 && e.code === "report_open"
    );
    assert.equal(f.s.reports.length, 1);
  } finally { restore(); }
});

test("sent again with the same reference, it is filed once", async () => {
  const f = fakeDb();
  const restore = f.install();
  try {
    await createForDriver({ driver: DRIVER, tripId: 55, input: notDelivered() });
    const again = await createForDriver({ driver: DRIVER, tripId: 55, input: notDelivered() });
    assert.equal(again.duplicate, true);
    assert.equal(again.report.id, 1);
    assert.equal(f.s.reports.length, 1);
    assert.equal(f.s.exceptions.length, 1);
  } finally { restore(); }
});

/* ---------------------------------------------------------------- */
/* Delivered with a problem                                         */
/* ---------------------------------------------------------------- */

test("delivered short: after the driver's own delivery, a shortage warning with the counts", async () => {
  const f = fakeDb({ status: "delivered" });
  const restore = f.install();
  try {
    const { report } = await createForDriver({ driver: DRIVER, tripId: 55, input: short(), files: [photoFile()] });
    assert.equal(report.outcome, "delivered_with_issue");
    const p = f.s.exceptions[0].params;
    assert.equal(p[4], "cargo_shortage");
    assert.equal(p[5], "warning");
    assert.match(p[6], /Short delivery \(8 of 10 delivered\)/);
    assert.equal(f.s.history[0][5], "DELIVERY_ISSUE_REPORTED");
    assert.equal(f.s.history[0][3], "delivered");
  } finally { restore(); }
});

test("damaged or the wrong item is a cargo damage warning", async () => {
  const f = fakeDb({ status: "delivered" });
  const restore = f.install();
  try {
    await createForDriver({ driver: DRIVER, tripId: 55, input: { clientRef: REF, outcome: "delivered_with_issue", reason: "wrong_item", note: "Wrong model sent" } });
    assert.equal(f.s.exceptions[0].params[4], "cargo_damage");
    assert.equal(f.s.exceptions[0].params[5], "warning");
  } finally { restore(); }
});

test("a problem with a delivery needs the delivery first, and it must be this driver's", async () => {
  let f = fakeDb({ status: "in_transit" });
  let restore = f.install();
  try {
    await assert.rejects(createForDriver({ driver: DRIVER, tripId: 55, input: short(), files: [photoFile()] }), /Confirm the delivery first/);
  } finally { restore(); }
  f = fakeDb({ status: "delivered", pod: false });
  restore = f.install();
  try {
    await assert.rejects(createForDriver({ driver: DRIVER, tripId: 55, input: short(), files: [photoFile()] }), /Only the driver who delivered/);
    assert.equal(f.s.reports.length, 0);
  } finally { restore(); }
});

/* ---------------------------------------------------------------- */
/* Settled by a later delivery                                      */
/* ---------------------------------------------------------------- */

test("a later delivery settles the report waiting on it, and its exception", async () => {
  const f = fakeDb();
  const restore = f.install();
  try {
    await createForDriver({ driver: DRIVER, tripId: 55, input: notDelivered() });
    const n = await settleOnDelivery(db, { tripId: 55, userId: 4 });
    assert.equal(n, 1);
    assert.equal(f.s.reports[0].status, "resolved");
    assert.equal(f.s.resolved[0][0], 4);
    assert.match(f.s.resolved[0][1], /later attempt/);
    assert.equal(f.s.settled.length, 1);
    assert.equal(f.s.settled[0][2], 1);
    // nothing left to settle
    assert.equal(await settleOnDelivery(db, { tripId: 55 }), 0);
  } finally { restore(); }
});

test("the driver's own delivery, on a later attempt, settles the report in the same transaction", async () => {
  const s = { settledReports: [], settledExceptions: [], commits: 0, order: [] };
  const run = async (sql, params = []) => {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.includes("SELECT tt.status, tt.branch_id")) return [[{ status: "in_transit", branch_id: 222 }]];
    if (q.startsWith("SELECT report_id AS id FROM delivery_reports")) return [[{ id: 31 }]];
    if (q.startsWith("UPDATE delivery_reports SET status = 'resolved'")) { s.settledReports.push(params[2]); s.order.push("report"); return [{}]; }
    if (q.startsWith("UPDATE operational_exceptions")) { s.settledExceptions.push(params[2]); return [{}]; }
    if (/^(INSERT|UPDATE|DELETE)/.test(q)) return [{}];
    return [[]];
  };
  const saved = { execute: db.execute, getConnection: db.getConnection };
  db.execute = run;
  db.getConnection = async () => ({
    beginTransaction: async () => {}, execute: run, rollback: async () => {}, release() {},
    commit: async () => { s.commits += 1; s.order.push("commit"); },
  });
  const photo = photoFile();
  try {
    const res = capture();
    await deliverTrip({
      params: { id: "55" }, driver: DRIVER, context: {}, user: {}, headers: {}, socket: {},
      body: { receivedBy: "Ana Reyes" }, files: { photo: [photo] },
    }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(s.settledReports, [31]);
    assert.deepEqual(s.settledExceptions, [31]);
    assert.deepEqual(s.order, ["report", "commit"]);
  } finally {
    db.execute = saved.execute; db.getConnection = saved.getConnection;
    fs.rmSync(photo.path, { force: true });
  }
});

test("a database without migration 063 delivers exactly as before", async () => {
  const f = fakeDb({ missingTable: true });
  const restore = f.install();
  try {
    assert.equal(await settleOnDelivery(db, { tripId: 55 }), 0);
  } finally { restore(); }
});

test("a pause cannot be asked for while a not-delivered report waits on the office", async () => {
  const f = fakeDb();
  const restore = f.install();
  try {
    await createForDriver({ driver: DRIVER, tripId: 55, input: notDelivered() });
    const out = await requestPause({
      driver: DRIVER, tripId: 55, files: [{ path: "x", mimetype: "image/jpeg", size: 1 }],
      input: { reason: "delay", description: "Stuck at the gate for two hours", clientRef: "pause-0123456789" },
    });
    assert.equal(out.status, 409);
    assert.match(out.error, /reported as not delivered/);
  } finally { restore(); }
});

/* ---------------------------------------------------------------- */
/* The route                                                        */
/* ---------------------------------------------------------------- */

test("the route: 201 with the report; a refusal or a resend removes the uploaded photos", async () => {
  const f = fakeDb();
  const restore = f.install();
  try {
    const first = photoFile();
    const res = capture();
    await driverCreate({ driver: DRIVER, params: { id: "55" }, body: notDelivered(), files: [first], headers: {}, get: () => "" }, res);
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.data.outcome, "not_delivered");
    // kept: it is the report's photo now
    assert.ok(fs.existsSync(first.path));

    const resent = photoFile();
    const again = capture();
    await driverCreate({ driver: DRIVER, params: { id: "55" }, body: notDelivered(), files: [resent], headers: {}, get: () => "" }, again);
    assert.equal(again.body.duplicate, true);
    assert.ok(await gone(resent.path));

    const refused = photoFile();
    const bad = capture();
    await driverCreate({ driver: DRIVER, params: { id: "55" }, body: notDelivered({ clientRef: "dlvr-other-0000001", note: "" }), files: [refused], headers: {}, get: () => "" }, bad);
    assert.equal(bad.statusCode, 400);
    assert.ok(await gone(refused.path));
    fs.rmSync(first.path, { force: true });
  } finally { restore(); }
});

/* ---------------------------------------------------------------- */
/* Migration 063                                                    */
/* ---------------------------------------------------------------- */

test("migration 063 creates the tables and adds the exception source once", async () => {
  const run = async (enumType) => {
    const queries = [];
    const conn = {
      query: async (sql) => {
        queries.push(sql.replace(/\s+/g, " ").trim());
        if (/information_schema\.COLUMNS/.test(sql)) return [[{ type: enumType }]];
        return [[]];
      },
    };
    await migrate063(conn);
    return queries;
  };
  const fresh = await run("enum('pause','support','inspection')");
  assert.ok(fresh.some((q) => q.startsWith("CREATE TABLE IF NOT EXISTS delivery_reports")));
  assert.ok(fresh.some((q) => q.startsWith("CREATE TABLE IF NOT EXISTS delivery_report_photos")));
  assert.ok(fresh.some((q) => q.includes("ENUM('pause','support','inspection','delivery_report')")));
  const again = await run("enum('pause','support','inspection','delivery_report')");
  assert.ok(!again.some((q) => q.startsWith("ALTER TABLE")));
});
