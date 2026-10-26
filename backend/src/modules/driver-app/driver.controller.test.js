import "../../config/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import db from "../../config/db.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { arriveAtStop, deliverTrip, getTrip, myTrail, ping, startTrip } from "./driver.controller.js";
import { submitExpense } from "./driverExpenses.controller.js";

function responseCapture() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}

test("a driver's trip carries the customer's contact so the app can offer a call", async () => {
  const execute = db.execute;
  const sqls = [];
  try {
    db.execute = async (sql) => {
      sqls.push(sql);
      if (sql.includes("FROM trip_assignments")) {
        return [[{ id: 55, ticketNo: "TT-1", customer: "Acme", customerContact: "Ana Reyes", customerPhone: "0917 123 4567" }]];
      }
      if (sql.includes("FROM trip_stops")) return [[]];
      throw new Error(`Unexpected query: ${sql}`);
    };
    const res = responseCapture();
    await getTrip({ params: { id: "55" }, driver: { driverId: 9, companyId: 7 } }, res);

    assert.equal(res.body.data.customerContact, "Ana Reyes");
    assert.equal(res.body.data.customerPhone, "0917 123 4567");
    // the columns are really asked for, and only through the driver's own assignment
    const q = sqls.find((s) => s.includes("FROM trip_assignments"));
    assert.match(q, /c\.contact_person AS customerContact/);
    assert.match(q, /c\.phone AS customerPhone/);
    assert.match(q, /ta\.driver_id = \?/);
  } finally {
    db.execute = execute;
  }
});

test("a driver ping is persisted under the assigned trip branch", async () => {
  const execute = db.execute;
  const calls = [];
  try {
    db.execute = async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes("FROM trip_assignments")) {
        return [[{
          vehicle_id: 77,
          status: "in_transit",
          branch_id: 222,
        }]];
      }
      if (sql.includes("INSERT INTO trip_tracking_points")) {
        return [{ insertId: 1 }];
      }
      throw new Error(`Unexpected query: ${sql}`);
    };

    let statusCode;
    let body;
    const res = {
      status(code) { statusCode = code; return this; },
      json(value) { body = value; return this; },
    };
    await ping(
      {
        params: { id: "55" },
        body: { lat: 14.5995, lng: 120.9842 },
        driver: {
          driverId: 9,
          companyId: 7,
          branchId: 111,
        },
      },
      res
    );

    const insert = calls.find((call) => call.sql.includes("INSERT INTO trip_tracking_points"));
    assert.ok(insert, "tracking point was not inserted");
    assert.equal(insert.params[0], 7, "company comes from the authenticated driver");
    assert.equal(insert.params[1], 222, "branch comes from the assigned trip");
    assert.notEqual(insert.params[1], 111, "driver home branch must not receive this trip's ping");
    assert.equal(statusCode, 201);
    assert.deepEqual(body, { success: true });
  } finally {
    db.execute = execute;
  }
});

test("a driver transition and its audit use the trip branch, not the driver's home", async () => {
  const getConnection = db.getConnection;
  const execute = db.execute;
  const transactionCalls = [];
  const auditCalls = [];
  try {
    db.getConnection = async () => ({
      async beginTransaction() {},
      async execute(sql, params) {
        transactionCalls.push({ sql, params });
        if (sql.includes("SELECT tt.status")) {
          return [[{ status: "released", branch_id: 222 }]];
        }
        return [{}];
      },
      async commit() {},
      async rollback() {},
      release() {},
    });
    db.execute = async (sql, params) => {
      auditCalls.push({ sql, params });
      return [{}];
    };

    const req = {
      params: { id: "55" },
      body: {},
      driver: { driverId: 9, companyId: 7, branchId: 111, name: "QA Driver" },
      context: { companyId: 7, branchId: 111 },
      user: { userId: null, email: "driver:DRV-009" },
      headers: {},
      socket: {},
    };
    const res = responseCapture();
    await startTrip(req, res);

    const history = transactionCalls.find((call) => call.sql.includes("INSERT INTO trip_status_history"));
    const audit = auditCalls.find((call) => call.sql.includes("INSERT INTO audit_logs"));
    assert.equal(history.params[1], 222);
    assert.equal(audit.params[1], 222);
    assert.equal(req.context.branchId, 222);
    assert.equal(res.body?.data?.status, "in_transit");
  } finally {
    db.getConnection = getConnection;
    db.execute = execute;
  }
});

test("a stop arrival and its audit use the trip branch", async () => {
  const getConnection = db.getConnection;
  const execute = db.execute;
  const transactionCalls = [];
  const auditCalls = [];
  try {
    db.getConnection = async () => ({
      async beginTransaction() {},
      async execute(sql, params) {
        transactionCalls.push({ sql, params });
        if (sql.includes("SELECT tt.trip_ticket_id")) {
          return [[{
            trip_ticket_id: 55,
            status: "in_transit",
            ticket_no: "QA-55",
            branch_id: 222,
          }]];
        }
        if (sql.includes("SELECT stop_id")) {
          return [[{ stop_id: 88, location_name: "QA Stop", actual_arrival: null }]];
        }
        return [{}];
      },
      async commit() {},
      async rollback() {},
      release() {},
    });
    db.execute = async (sql, params) => {
      auditCalls.push({ sql, params });
      return [{}];
    };

    const req = {
      params: { id: "55", stopId: "88" },
      body: { lat: 7.1, lng: 125.6 },
      driver: { driverId: 9, companyId: 7, branchId: 111, name: "QA Driver" },
      context: { companyId: 7, branchId: 111 },
      user: { userId: null, email: "driver:DRV-009" },
      headers: {},
      socket: {},
    };
    const res = responseCapture();
    await arriveAtStop(req, res);

    const history = transactionCalls.find((call) => call.sql.includes("INSERT INTO trip_status_history"));
    const audit = auditCalls.find((call) => call.sql.includes("INSERT INTO audit_logs"));
    assert.equal(history.params[1], 222);
    assert.equal(audit.params[1], 222);
    assert.equal(req.context.branchId, 222);
    assert.equal(res.body?.data?.stopId, 88);
  } finally {
    db.getConnection = getConnection;
    db.execute = execute;
  }
});

test("a driver expense audit follows the assigned trip branch", async () => {
  const getConnection = db.getConnection;
  const execute = db.execute;
  const auditCalls = [];
  try {
    db.execute = async (sql, params) => {
      if (sql.includes("FROM trip_assignments")) {
        return [[{
          trip_ticket_id: 55,
          branch_id: 222,
          status: "in_transit",
          ticket_no: "QA-55",
          within_window: 1,
        }]];
      }
      auditCalls.push({ sql, params });
      return [{}];
    };
    db.getConnection = async () => ({
      async beginTransaction() {},
      async execute() { return [{ insertId: 901 }]; },
      async commit() {},
      async rollback() {},
      release() {},
    });

    const req = {
      params: { id: "55" },
      body: { category: "fuel", amount: "500" },
      driver: { driverId: 9, companyId: 7, branchId: 111, name: "QA Driver" },
      context: { companyId: 7, branchId: 111 },
      user: { userId: null, email: "driver:DRV-009" },
      headers: {},
      socket: {},
    };
    const res = responseCapture();
    await submitExpense(req, res);

    const audit = auditCalls.find((call) => call.sql.includes("INSERT INTO audit_logs"));
    assert.equal(req.context.branchId, 222);
    assert.equal(audit.params[1], 222);
    assert.equal(res.statusCode, 201);
  } finally {
    db.getConnection = getConnection;
    db.execute = execute;
  }
});

/* ---- an expense sent twice on a weak signal ---- */

const expenseReq = (body) => ({
  params: { id: "55" },
  body,
  driver: { driverId: 9, companyId: 7, branchId: 111, name: "QA Driver" },
  context: { companyId: 7, branchId: 111 },
  user: { userId: null, email: "driver:DRV-009" },
  headers: {},
  socket: {},
});
const assignedTripRow = [[{ trip_ticket_id: 55, branch_id: 222, status: "in_transit", ticket_no: "QA-55", within_window: 1 }]];

test("an expense sent again with the same clientRef is filed once", async () => {
  const getConnection = db.getConnection;
  const execute = db.execute;
  let opened = false;
  try {
    db.execute = async (sql) => {
      if (sql.includes("FROM trip_assignments")) return assignedTripRow;
      if (sql.includes("client_ref = ?")) return [[{ expense_id: 901, attachment_count: 1 }]];
      return [{}];
    };
    db.getConnection = async () => { opened = true; throw new Error("must not insert"); };
    const res = responseCapture();
    await submitExpense(expenseReq({ category: "fuel", amount: "500", clientRef: "a1b2c3d4-e5f6" }), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.data, { id: 901, hasReceipt: true });
    assert.equal(opened, false, "nothing is inserted a second time");
  } finally {
    db.getConnection = getConnection;
    db.execute = execute;
  }
});

test("a first-time expense is stored with its clientRef, so a resend can find it", async () => {
  const getConnection = db.getConnection;
  const execute = db.execute;
  const inserts = [];
  try {
    db.execute = async (sql) => {
      if (sql.includes("FROM trip_assignments")) return assignedTripRow;
      if (sql.includes("client_ref = ?")) return [[]];
      return [{}];
    };
    db.getConnection = async () => ({
      async beginTransaction() {},
      async execute(sql, params) { inserts.push({ sql, params }); return [{ insertId: 902 }]; },
      async commit() {},
      async rollback() {},
      release() {},
    });
    const res = responseCapture();
    await submitExpense(expenseReq({ category: "fuel", amount: "500", clientRef: "a1b2c3d4-e5f6" }), res);
    assert.equal(res.statusCode, 201);
    const insert = inserts.find((c) => c.sql.includes("INSERT INTO trip_expenses"));
    assert.match(insert.sql, /client_ref/);
    assert.equal(insert.params.at(-1), "a1b2c3d4-e5f6");
  } finally {
    db.getConnection = getConnection;
    db.execute = execute;
  }
});

test("two copies arriving together: the loser answers with the winner, not an error", async () => {
  const getConnection = db.getConnection;
  const execute = db.execute;
  let lookups = 0;
  try {
    db.execute = async (sql) => {
      if (sql.includes("FROM trip_assignments")) return assignedTripRow;
      if (sql.includes("client_ref = ?")) { lookups += 1; return lookups === 1 ? [[]] : [[{ expense_id: 903, attachment_count: 0 }]]; }
      return [{}];
    };
    db.getConnection = async () => ({
      async beginTransaction() {},
      async execute() { throw Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY" }); },
      async commit() {},
      async rollback() {},
      release() {},
    });
    const res = responseCapture();
    await submitExpense(expenseReq({ category: "fuel", amount: "500", clientRef: "a1b2c3d4-e5f6" }), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.data, { id: 903, hasReceipt: false });
  } finally {
    db.getConnection = getConnection;
    db.execute = execute;
  }
});

/* ---- the route driven, after delivery ---- */

function trailDb(status, points) {
  const calls = [];
  db.execute = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes("FROM trip_assignments")) return [[{ id: 55, ticketNo: "TT-1", status }]];
    if (sql.includes("FROM trip_stops")) return [[]];
    if (sql.includes("FROM trip_tracking_points")) return [points]; // the trail itself
    throw new Error(`Unexpected query: ${sql}`);
  };
  return calls;
}

test("a delivered run returns the driver's own trail, road-snapped, with the distance driven", async () => {
  const execute = db.execute;
  const fetchBefore = globalThis.fetch;
  try {
    const calls = trailDb("delivered", [
      { latitude: "7.0731", longitude: "125.6128", recorded_at: "2026-08-29T02:02:00.000Z" },
      { latitude: "7.0831", longitude: "125.6128", recorded_at: "2026-08-29T02:10:00.000Z" },
    ]);
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ code: "Ok", matchings: [{ geometry: { coordinates: [[125.6128, 7.0731], [125.613, 7.078], [125.6128, 7.0831]] } }] }),
    });
    const res = responseCapture();
    await myTrail({ params: { id: "55" }, driver: { driverId: 9, companyId: 7 } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.points.length, 2);
    assert.deepEqual(res.body.data.points[0], { lat: 7.0731, lng: 125.6128, at: "2026-08-29T02:02:00.000Z" });
    assert.equal(res.body.data.snapped.coordinates.length, 3);
    assert.ok(Math.abs(res.body.data.distanceKm - 1.11) < 0.02, `distance ${res.body.data.distanceKm}`);
    assert.equal(res.body.data.startedAt, "2026-08-29T02:02:00.000Z");
    // only this driver's fixes, for this trip and company
    const q = calls.find((c) => c.sql.includes("FROM trip_tracking_points") && !c.sql.includes("FROM trip_assignments"));
    assert.match(q.sql, /driver_id = \?/);
    assert.deepEqual(q.params, [55, 7, 9]);
  } finally {
    db.execute = execute;
    globalThis.fetch = fetchBefore;
  }
});

test("the trail falls back to the raw fixes when road matching fails, and can be empty", async () => {
  const execute = db.execute;
  const fetchBefore = globalThis.fetch;
  try {
    trailDb("operationally_closed", [
      { latitude: 7.07, longitude: 125.61, recorded_at: "2026-08-29T02:02:00.000Z" },
      { latitude: 7.08, longitude: 125.61, recorded_at: "2026-08-29T02:10:00.000Z" },
    ]);
    globalThis.fetch = async () => { throw new Error("offline"); };
    let res = responseCapture();
    await myTrail({ params: { id: "55" }, driver: { driverId: 9, companyId: 7 } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.snapped, null);
    assert.equal(res.body.data.points.length, 2);

    trailDb("delivered", []);
    res = responseCapture();
    await myTrail({ params: { id: "55" }, driver: { driverId: 9, companyId: 7 } }, res);
    assert.deepEqual(res.body.data, { points: [], snapped: null, distanceKm: 0, startedAt: null, endedAt: null });
  } finally {
    db.execute = execute;
    globalThis.fetch = fetchBefore;
  }
});

test("the trail is refused before delivery and for someone else's trip", async () => {
  const execute = db.execute;
  try {
    const calls = trailDb("in_transit", []);
    let res = responseCapture();
    await myTrail({ params: { id: "55" }, driver: { driverId: 9, companyId: 7 } }, res);
    assert.equal(res.statusCode, 409);
    assert.ok(!calls.some((c) => c.sql.includes("FROM trip_tracking_points") && !c.sql.includes("FROM trip_assignments")));

    db.execute = async (sql) => {
      if (sql.includes("FROM trip_assignments")) return [[]];
      throw new Error(`Unexpected query: ${sql}`);
    };
    res = responseCapture();
    await myTrail({ params: { id: "56" }, driver: { driverId: 9, companyId: 7 } }, res);
    assert.equal(res.statusCode, 404);
  } finally {
    db.execute = execute;
  }
});

test("a ping off the globe is refused before anything is read or stored", async () => {
  const execute = db.execute;
  let queried = false;
  db.execute = async () => { queried = true; return [[]]; };
  try {
    for (const body of [{ lat: 999, lng: 120.9 }, { lat: 14.5, lng: -181 }, { lat: -90.1, lng: 0 }]) {
      let statusCode;
      const res = { status(code) { statusCode = code; return this; }, json() { return this; } };
      // eslint-disable-next-line no-await-in-loop
      await ping({ params: { id: "55" }, body, driver: { driverId: 9, companyId: 7 } }, res);
      assert.equal(statusCode, 400, JSON.stringify(body));
    }
    assert.equal(queried, false, "nothing reaches the database");
  } finally {
    db.execute = execute;
  }
});

/* ---------------------------------------------------------------- */
/* A step sent again (outbox replay, or a resend after a lost answer) */
/* ---------------------------------------------------------------- */

/**
 * A stand-in database for one trip, with just enough state to tell a first
 * send from a resend: the trip's status, the POD (and whose it is), and one
 * stop. `writes` lists every statement that would change something.
 */
function tripDb({ status = "in_transit", podDriverId = null, stop = null } = {}) {
  const state = { status, podDriverId, stop, committed: 0 };
  const writes = [];
  const run = async (sql, params = []) => {
    if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) writes.push(sql.replace(/\s+/g, " ").trim());
    if (sql.includes("SELECT tt.status")) return [[{ status: state.status, branch_id: 222 }]];
    if (sql.includes("SELECT tt.trip_ticket_id")) {
      return [[{ trip_ticket_id: 55, status: state.status, ticket_no: "QA-55", branch_id: 222 }]];
    }
    if (sql.includes("FROM trip_pod")) {
      return [state.podDriverId != null && Number(params[1]) === Number(state.podDriverId) ? [{ found: 1 }] : []];
    }
    if (sql.includes("FROM trip_stops") && sql.includes("arrived_by_driver_id = ?")) {
      const mine = state.stop?.actual_arrival && Number(state.stop.arrived_by_driver_id) === Number(params[2]);
      return [mine ? [{ found: 1 }] : []];
    }
    if (sql.includes("SELECT stop_id")) return [state.stop ? [state.stop] : []];
    if (/^\s*UPDATE trip_tickets/i.test(sql)) state.status = params[0];
    if (/^\s*INSERT INTO trip_pod/i.test(sql)) state.podDriverId = params[2];
    if (/^\s*SELECT/i.test(sql)) return [[]];
    return [{}];
  };
  const install = () => {
    const saved = { getConnection: db.getConnection, execute: db.execute };
    db.getConnection = async () => ({
      beginTransaction: async () => {},
      execute: run,
      commit: async () => { state.committed += 1; },
      rollback: async () => {},
      release() {},
    });
    db.execute = run;
    return () => { db.getConnection = saved.getConnection; db.execute = saved.execute; };
  };
  return { state, writes, install };
}

const driverReq = (extra = {}) => ({
  params: { id: "55", stopId: "88" },
  body: {},
  driver: { driverId: 9, companyId: 7, branchId: 111, name: "QA Driver" },
  context: { companyId: 7, branchId: 111 },
  user: { userId: null, email: "driver:DRV-009" },
  headers: {},
  socket: {},
  ...extra,
});

/** A real file standing in for the photo multer saved, so its removal can be seen. */
function uploadedPhoto() {
  const file = path.join(os.tmpdir(), `trackify-pod-${process.pid}-${Math.random().toString(36).slice(2)}.jpg`);
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

test("a start sent again after it went through is answered as done, and nothing is written twice", async () => {
  for (const status of ["in_transit", "delivered", "operationally_closed"]) {
    const t = tripDb({ status });
    const restore = t.install();
    try {
      const res = responseCapture();
      // eslint-disable-next-line no-await-in-loop
      await startTrip(driverReq(), res);
      assert.equal(res.statusCode, 200, status);
      assert.equal(res.body.data.alreadyDone, true);
      assert.equal(res.body.data.status, status);
      assert.deepEqual(t.writes, [], `wrote on a resend while ${status}`);
      assert.equal(t.state.committed, 0);
    } finally {
      restore();
    }
  }
});

test("a start the trip is not ready for is still refused", async () => {
  const t = tripDb({ status: "assigned" });
  const restore = t.install();
  try {
    const res = responseCapture();
    await startTrip(driverReq(), res);
    assert.equal(res.statusCode, 409);
    assert.deepEqual(t.writes, []);
  } finally {
    restore();
  }
});

test("a delivery sent again after it went through is done, files one POD, and drops the second photo", async () => {
  const t = tripDb({ status: "in_transit" });
  const restore = t.install();
  try {
    const first = responseCapture();
    const firstPhoto = uploadedPhoto();
    await deliverTrip(driverReq({ body: { receivedBy: "Ana Reyes" }, file: firstPhoto }), first);
    assert.equal(first.statusCode, 200);
    assert.equal(first.body.data.status, "delivered");

    const again = responseCapture();
    const replayPhoto = uploadedPhoto();
    await deliverTrip(driverReq({ body: { receivedBy: "Ana Reyes" }, file: replayPhoto }), again);
    assert.equal(again.statusCode, 200);
    assert.equal(again.body.data.alreadyDone, true);

    assert.equal(t.writes.filter((s) => s.startsWith("INSERT INTO trip_pod")).length, 1);
    assert.equal(t.writes.filter((s) => s.startsWith("UPDATE trip_tickets")).length, 1);
    assert.ok(await gone(replayPhoto.path), "the replay's photo was kept");
    assert.ok(fs.existsSync(firstPhoto.path), "the filed photo was removed");
    fs.unlinkSync(firstPhoto.path);
  } finally {
    restore();
  }
});

test("a delivery resend after the office closed the trip is still done, if the POD is this driver's", async () => {
  const t = tripDb({ status: "operationally_closed", podDriverId: 9 });
  const restore = t.install();
  try {
    const res = responseCapture();
    const photo = uploadedPhoto();
    await deliverTrip(driverReq({ body: { receivedBy: "Ana Reyes" }, file: photo }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.alreadyDone, true);
    assert.deepEqual(t.writes, []);
    assert.ok(await gone(photo.path));
  } finally {
    restore();
  }
});

test("a delivery on a trip delivered without this driver's POD is refused, not taken as done", async () => {
  // the office confirmed it, or another driver did: this driver's photo was never filed
  for (const podDriverId of [null, 31]) {
    const t = tripDb({ status: "delivered", podDriverId });
    const restore = t.install();
    try {
      const res = responseCapture();
      const photo = uploadedPhoto();
      // eslint-disable-next-line no-await-in-loop
      await deliverTrip(driverReq({ body: { receivedBy: "Ana Reyes" }, file: photo }), res);
      assert.equal(res.statusCode, 409, `POD by ${podDriverId}`);
      assert.deepEqual(t.writes, []);
      // eslint-disable-next-line no-await-in-loop
      assert.ok(await gone(photo.path));
    } finally {
      restore();
    }
  }
});

test("a stop arrival sent again is done, on a moving trip and after the run has ended", async () => {
  for (const status of ["in_transit", "delivered"]) {
    const t = tripDb({ status, stop: { stop_id: 88, location_name: "QA Stop", actual_arrival: new Date(), arrived_by_driver_id: 9 } });
    const restore = t.install();
    try {
      const res = responseCapture();
      // eslint-disable-next-line no-await-in-loop
      await arriveAtStop(driverReq({ body: { lat: 7.1, lng: 125.6 } }), res);
      assert.equal(res.statusCode, 200, status);
      assert.equal(res.body.data.alreadyDone, true);
      assert.equal(res.body.data.stopId, 88);
      assert.deepEqual(t.writes, []);
    } finally {
      restore();
    }
  }
});

test("a stop reached by someone else, or never, is not taken as this driver's resend", async () => {
  const cases = [
    { status: "in_transit", stop: { stop_id: 88, location_name: "QA Stop", actual_arrival: new Date(), arrived_by_driver_id: null } },
    { status: "in_transit", stop: { stop_id: 88, location_name: "QA Stop", actual_arrival: new Date(), arrived_by_driver_id: 31 } },
    { status: "delivered", stop: { stop_id: 88, location_name: "QA Stop", actual_arrival: null, arrived_by_driver_id: null } },
  ];
  for (const c of cases) {
    const t = tripDb(c);
    const restore = t.install();
    try {
      const res = responseCapture();
      // eslint-disable-next-line no-await-in-loop
      await arriveAtStop(driverReq(), res);
      assert.equal(res.statusCode, 409, JSON.stringify(c.stop));
      assert.deepEqual(t.writes, []);
    } finally {
      restore();
    }
  }
});
