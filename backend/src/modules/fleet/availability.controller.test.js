import "../../config/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import db from "../../config/db.js";
import { fleetAvailability } from "./availability.controller.js";

/**
 * The dispatch pickers offer only what dispatch will accept.
 *
 * They list rows marked "available". A driver with a lapsed licence, or a
 * vehicle with a lapsed registration, used to be marked available here and
 * then refused by the assignment itself.
 */

// 2026-10-15 03:00 in Manila, still the 14th in UTC
const MANILA_MORNING = new Date("2026-10-14T19:00:00Z");

async function run(answer) {
  const calls = [];
  const real = db.execute;
  db.execute = async (sql, params) => { calls.push({ sql, params }); return answer(sql); };
  const out = {};
  try {
    await fleetAvailability({ context: { companyId: 3 } }, { json(v) { out.body = v; } });
  } finally {
    db.execute = real;
  }
  return { out, calls };
}

test("a driver whose licence has lapsed is not offered as available", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: MANILA_MORNING });
  const { out } = await run((sql) => (sql.includes("FROM drivers") ? [[
    { driver_id: 1, availability: "available", license_expiry: "2026-10-15" }, // good through today, Manila
    { driver_id: 2, availability: "available", license_expiry: "2026-10-14" }, // lapsed yesterday, Manila
    { driver_id: 3, availability: "available", license_expiry: null },
    { driver_id: 4, availability: "on_trip", license_expiry: "2026-10-14" },
  ]] : [[]]));

  assert.deepEqual(out.body.data.drivers.map((d) => [d.driver_id, d.availability]), [
    [1, "available"], [2, "licence_expired"], [3, "no_licence_expiry"], [4, "on_trip"],
  ]);
});

test("a vehicle whose registration has lapsed is marked so, against today in Manila", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: MANILA_MORNING });
  const { calls } = await run(() => [[]]);
  const vehicles = calls.find((c) => c.sql.includes("FROM vehicles"));
  assert.match(vehicles.sql, /registration_expiry < \? THEN 'registration_expired'/);
  assert.deepEqual(vehicles.params, ["2026-10-15", 3]);
});
