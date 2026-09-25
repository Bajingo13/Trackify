import "../../config/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import db from "../../config/db.js";
import { arriveAtStop, ping, startTrip } from "./driver.controller.js";
import { submitExpense } from "./driverExpenses.controller.js";

function responseCapture() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}

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
