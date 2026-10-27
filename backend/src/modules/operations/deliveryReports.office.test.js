import "../../config/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import db from "../../config/db.js";
import { reattemptAsStaff, resolveAsStaff } from "./deliveryReports.service.js";
import { officeReattempt, officeReturn } from "./deliveryReports.controller.js";
import { TRANSITIONS } from "./trip-status.service.js";
import * as bridge from "../support/exceptionBridge.service.js";
import { publicView } from "../support/pause.service.js";

/**
 * Phase 6b: the office decides a delivery report from the Exceptions panel —
 * try again, take the load back, or resolve it — and the report, its exception,
 * the trip and the customer's page all tell the same story.
 */

const CONTEXT = { companyId: 7, branchId: 222, userId: 4 };
const USER = { userId: 4, name: "Dina Dispatcher" };

/** A stand-in database: one exception from one report on one trip, and what gets written. */
function fakeDb({ outcome = "not_delivered", reportStatus = "open", tripStatus = "in_transit" } = {}) {
  const s = {
    report: { id: 31, outcome, reason: "absent", status: reportStatus, tripId: 55, driverId: 9, ticketNo: "TT-0055" },
    trip: { status: tripStatus, actualArrival: null },
    exception: { status: "open" },
    history: [], audits: 0, assignment: null, commits: 0, rollbacks: 0,
  };
  const run = async (sql, params = []) => {
    const q = sql.replace(/\s+/g, " ").trim();
    // the exception and its source
    if (q.includes("FROM operational_exceptions WHERE exception_id = ?")) {
      return [[params[0] === 900 ? { id: 900, status: s.exception.status, sourceKind: "delivery_report", sourceId: 31, tripId: 55 } : undefined].filter(Boolean)];
    }
    // the report, for a decision (locked or not)
    if (q.includes("FROM delivery_reports r JOIN trip_tickets tt") && q.includes("r.report_id = ?") && !q.includes("r.note")) {
      return [[{ ...s.report, tripStatus: s.trip.status }]];
    }
    // the report, for the panel
    if (q.includes("FROM delivery_reports r JOIN trip_tickets tt") && q.includes("r.note")) {
      return [[{ ...s.report, tripStatus: s.trip.status, driverName: "Juan Dela Cruz", note: "Gate locked", qtyExpected: null, qtyDelivered: null, lat: "7.07", lng: "125.61" }]];
    }
    if (q.startsWith("SELECT photo_id AS id FROM delivery_report_photos")) return [[{ id: 1 }, { id: 2 }]];
    if (q.startsWith("UPDATE delivery_reports SET status = 'reattempt'")) { s.report.status = "reattempt"; s.report.note = params[0]; return [{}]; }
    if (q.startsWith("UPDATE delivery_reports SET status = 'resolved'")) { s.report.status = "resolved"; s.report.note = params[1]; return [{}]; }
    if (q.startsWith("UPDATE delivery_reports SET status = 'returned'")) { s.report.status = "returned"; s.report.note = params[1]; return [{}]; }
    if (q.startsWith("UPDATE operational_exceptions SET status = 'acknowledged'")) { s.exception.status = "acknowledged"; return [{}]; }
    if (q.startsWith("UPDATE operational_exceptions SET status = 'resolved'")) { s.exception.status = "resolved"; s.exception.notes = params[1]; return [{}]; }
    if (q.startsWith("INSERT INTO trip_status_history")) { s.history.push(params); return [{}]; }
    // the transition
    if (q.startsWith("SELECT trip_ticket_id, ticket_no, status, route_distance_km FROM trip_tickets")) {
      return [[{ trip_ticket_id: 55, ticket_no: "TT-0055", status: s.trip.status, route_distance_km: 12 }]];
    }
    if (q.startsWith("UPDATE trip_tickets SET status = ?")) {
      s.trip.status = params[0];
      if (q.includes("actual_arrival")) s.trip.actualArrival = "now";
      return [{}];
    }
    if (q.startsWith("UPDATE trip_assignments")) { s.assignment = params[0]; return [{ affectedRows: 1 }]; }
    if (q.startsWith("INSERT INTO audit_logs")) { s.audits += 1; return [{}]; }
    if (/^(INSERT|UPDATE|DELETE)/.test(q)) return [{ affectedRows: 0 }];
    return [[]];
  };
  const install = () => {
    const saved = { execute: db.execute, getConnection: db.getConnection, query: db.query };
    db.execute = run;
    db.query = run;
    db.getConnection = async () => ({
      beginTransaction: async () => {}, execute: run, query: run, release() {},
      commit: async () => { s.commits += 1; }, rollback: async () => { s.rollbacks += 1; },
    });
    return () => { db.execute = saved.execute; db.getConnection = saved.getConnection; db.query = saved.query; };
  };
  return { s, install };
}

const capture = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(v) { this.body = v; return this; } });
const officeReq = (body = {}) => ({
  params: { id: "900" }, body, context: { ...CONTEXT }, user: { userId: 4, email: "dina@example.test" },
  headers: {}, socket: {}, ip: "127.0.0.1", get: () => "",
});

/* ---------------------------------------------------------------- */
/* Reattempt                                                        */
/* ---------------------------------------------------------------- */

test("try again: the report waits on the driver, the exception is acknowledged, the trip stays on the road", async () => {
  const f = fakeDb();
  const restore = f.install();
  try {
    const out = await reattemptAsStaff({ context: CONTEXT, user: USER, reportId: 31, note: "Customer will be there at 3pm" });
    assert.deepEqual(out, { tripId: 55, status: "reattempt" });
    assert.equal(f.s.report.status, "reattempt");
    assert.equal(f.s.exception.status, "acknowledged");
    assert.equal(f.s.trip.status, "in_transit");
    assert.equal(f.s.history[0][5], "DELIVERY_REATTEMPT");
    assert.match(f.s.history[0][6], /3pm/);
  } finally { restore(); }
});

test("try again only for a load not delivered, not decided yet, on the road", async () => {
  for (const [opts, message] of [
    [{ outcome: "delivered_with_issue" }, /not delivered can be tried again/],
    [{ reportStatus: "reattempt" }, /already been decided/],
    [{ tripStatus: "delivered" }, /no longer on the road/],
  ]) {
    const f = fakeDb(opts);
    const restore = f.install();
    try {
      await assert.rejects(reattemptAsStaff({ context: CONTEXT, user: USER, reportId: 31 }), (e) => e.status === 409 && message.test(e.message));
      assert.equal(f.s.commits, 0);
    } finally { restore(); }
  }
});

test("the route answers with the decision, and audits it", async () => {
  const f = fakeDb();
  const restore = f.install();
  try {
    const res = capture();
    await officeReattempt(officeReq({ note: "" }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.status, "reattempt");
    const again = capture();
    await officeReattempt(officeReq(), again);
    assert.equal(again.statusCode, 409);
  } finally { restore(); }
});

/* ---------------------------------------------------------------- */
/* Mark returned                                                    */
/* ---------------------------------------------------------------- */

test("mark returned: the trip moves to returned through the transition, with the report settled in it", async () => {
  const f = fakeDb();
  const restore = f.install();
  try {
    const res = capture();
    await officeReturn(officeReq({ note: "Customer cancelled the order" }), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.data, { status: "returned" });
    assert.equal(f.s.trip.status, "returned");
    // a returned load is not a delivery: no arrival time, so it never counts as on time
    assert.equal(f.s.trip.actualArrival, null);
    // the truck and driver are freed
    assert.equal(f.s.assignment, "completed");
    assert.equal(f.s.report.status, "returned");
    assert.equal(f.s.exception.status, "resolved");
    assert.match(f.s.exception.notes, /Marked returned: Customer cancelled the order/);
    const line = f.s.history.find((h) => h[5] === "RETURN_TRIP");
    assert.ok(line, "the timeline says it came back");
    assert.equal(line[3], "in_transit");
    assert.equal(line[4], "returned");
    assert.equal(f.s.commits, 1);
  } finally { restore(); }
});

test("mark returned is refused for a settled report or a trip off the road, and nothing is written", async () => {
  for (const opts of [{ reportStatus: "resolved" }, { tripStatus: "delivered" }, { outcome: "delivered_with_issue" }]) {
    const f = fakeDb(opts);
    const restore = f.install();
    try {
      const res = capture();
      await officeReturn(officeReq(), res);
      assert.equal(res.statusCode, 409);
      assert.equal(f.s.commits, 0);
      assert.notEqual(f.s.trip.status, "returned");
    } finally { restore(); }
  }
});

test("a report settled by someone else a moment earlier rolls the return back", async () => {
  const f = fakeDb();
  const restore = f.install();
  try {
    // passes the first check, then is settled before the transition locks it
    const original = db.execute;
    let checks = 0;
    db.execute = async (sql, params) => {
      if (/FROM delivery_reports r\s+JOIN trip_tickets tt/.test(sql) && !/FOR UPDATE/.test(sql) && (checks += 1) === 1) {
        const out = await original(sql, params);
        f.s.report.status = "resolved";
        return out;
      }
      return original(sql, params);
    };
    await assert.rejects(officeReturn(officeReq(), capture()), (e) => e.status === 409);
    assert.equal(f.s.rollbacks, 1);
    assert.equal(f.s.commits, 0);
  } finally { restore(); }
});

test("the return step is the office's, from in transit only", () => {
  assert.deepEqual(TRANSITIONS.return.from, ["in_transit"]);
  assert.equal(TRANSITIONS.return.to, "returned");
  assert.equal(TRANSITIONS.return.extraSet, undefined);
  // reachable only through the delivery report's route
  const routes = fs.readFileSync(new URL("./trips.routes.js", import.meta.url), "utf8");
  assert.ok(!/["']return["']/.test(routes));
  const exRoutes = fs.readFileSync(new URL("./exceptions.routes.js", import.meta.url), "utf8");
  assert.match(exRoutes, /delivery-report\/return", requirePermission\("exception\.resolve"\)/);
  assert.match(exRoutes, /delivery-report\/reattempt", requirePermission\("exception\.resolve"\)/);
});

/* ---------------------------------------------------------------- */
/* Resolve, and the panel                                           */
/* ---------------------------------------------------------------- */

test("resolve settles the report with its exception, needs a note, and leaves the trip alone", async () => {
  const f = fakeDb();
  const restore = f.install();
  try {
    await assert.rejects(resolveAsStaff({ context: CONTEXT, user: USER, reportId: 31, note: " " }), /notes are required/);
    const out = await bridge.resolve({ context: CONTEXT, user: USER, exceptionId: 900, notes: "Customer collected it at the depot" });
    assert.equal(out.handled, true);
    assert.equal(out.status, 200);
    assert.equal(f.s.report.status, "resolved");
    assert.equal(f.s.exception.status, "resolved");
    assert.equal(f.s.trip.status, "in_transit");
    assert.equal(f.s.history.at(-1)[5], "DELIVERY_REPORT_RESOLVED");
    // twice: refused, not a 500
    const again = await bridge.resolve({ context: CONTEXT, user: USER, exceptionId: 900, notes: "again" });
    assert.equal(again.status, 409);
  } finally { restore(); }
});

test("the panel reads the report with its photos; there is no conversation behind it", async () => {
  const f = fakeDb();
  const restore = f.install();
  try {
    const { report } = await bridge.driverReport(CONTEXT, 900);
    assert.equal(report.kind, "delivery");
    assert.equal(report.delivery.reasonLabel, "Receiver absent or closed");
    assert.equal(report.delivery.lat, 7.07);
    assert.deepEqual(report.delivery.photos, [{ id: 1 }, { id: 2 }]);
    assert.deepEqual(await bridge.thread(CONTEXT, 900), { thread: null });
    const said = await bridge.replyToDriver({ context: CONTEXT, user: USER, exceptionId: 900, body: "hello" });
    assert.equal(said.status, 409);
    assert.match(said.error, /delivery report/);
    // acknowledging is the ordinary kind
    assert.equal((await bridge.acknowledge({ context: CONTEXT, user: USER, exceptionId: 900 })).handled, false);
  } finally { restore(); }
});

/* ---------------------------------------------------------------- */
/* The customer's page                                              */
/* ---------------------------------------------------------------- */

function trackDb({ status, returnedBefore = false }) {
  const run = async (sql) => {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.includes("FROM trip_tracking_links l")) {
      return [[{ linkId: 1, tripId: 55, expiresAt: new Date(Date.now() + 3600e3), revokedAt: null, tripNo: "TT-0055", status, origin: "A", destination: "B", companyName: "Co" }]];
    }
    if (q.includes("FROM trip_status_history") && q.includes("to_status = 'returned'")) return [[returnedBefore ? { returned: 1 } : undefined].filter(Boolean)];
    if (/^UPDATE/.test(q)) return [{}];
    return [[]];
  };
  const saved = db.execute;
  db.execute = run;
  return () => { db.execute = saved; };
}

test("the customer is never told a returned load was delivered — before or after the trip is closed", async () => {
  const token = "x".repeat(32);
  for (const [opts, stage, label] of [
    [{ status: "returned" }, "not_delivered", "Not delivered"],
    [{ status: "operationally_closed", returnedBefore: true }, "not_delivered", "Not delivered"],
    [{ status: "operationally_closed" }, "delivered", "Delivered"],
    [{ status: "delivered" }, "delivered", "Delivered"],
  ]) {
    const restore = trackDb(opts);
    try {
      const { view } = await publicView(token);
      assert.equal(view.stage, stage, JSON.stringify(opts));
      assert.equal(view.statusLabel, label);
    } finally { restore(); }
  }
});

test("returned trips count in the warehouse's cargo reconciliation", () => {
  const src = fs.readFileSync(new URL("../warehouse/cargo.controller.js", import.meta.url), "utf8");
  assert.equal((src.match(/'cancelled','delivered','returned','operationally_closed','rejected'/g) || []).length, 2);
});
