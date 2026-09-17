import "../../config/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import db from "../../config/db.js";
import { ping } from "./driver.controller.js";

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
