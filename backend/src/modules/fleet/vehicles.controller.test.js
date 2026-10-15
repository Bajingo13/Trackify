import "../../config/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import db from "../../config/db.js";
import { listVehicles, getVehicle, vehicleStats } from "./vehicles.controller.js";

/**
 * A vehicle counts as available only if dispatch would take it. One with a
 * lapsed registration is refused at assignment, so it is reported as
 * 'registration_expired', judged against today in Manila.
 */

// 2026-10-15 03:00 in Manila, still the 14th in UTC
const MANILA_MORNING = new Date("2026-10-14T19:00:00Z");

async function capture(fn, answer = () => [[]]) {
  const calls = [];
  const real = db.execute;
  db.execute = async (sql, params) => { calls.push({ sql, params }); return answer(sql); };
  const out = {};
  const res = { status() { return this; }, json(v) { out.body = v; return this; } };
  try { await fn(res); } finally { db.execute = real; }
  return { calls, out };
}

test("stats leave a lapsed registration out of Available, and count it on its own", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: MANILA_MORNING });
  const { calls, out } = await capture(
    (res) => vehicleStats({ context: { companyId: 2 } }, res),
    (sql) => (sql.includes("GROUP BY s")
      ? [[{ s: "available", n: 3 }, { s: "registration_expired", n: 2 }, { s: "inactive", n: 1 }]]
      : [[{ overdue: 0, dueSoon: 0 }]]),
  );
  const status = calls.find((c) => c.sql.includes("GROUP BY s"));
  assert.match(status.sql, /registration_expiry < \? THEN 'registration_expired'/);
  assert.deepEqual(status.params, ["2026-10-15", 2]);
  assert.equal(out.body.data.available, 3);
  assert.equal(out.body.data.registrationExpired, 2);
  assert.equal(out.body.data.total, 6);
});

test("the list and a single vehicle use the same rule, with the date first", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: MANILA_MORNING });
  const list = await capture((res) => listVehicles({ context: { companyId: 2 }, query: { search: "ABC" } }, res));
  assert.deepEqual(list.calls[0].params, ["2026-10-15", 2, "%ABC%", "%ABC%", "%ABC%", "%ABC%"]);
  const one = await capture((res) => getVehicle({ context: { companyId: 2 }, params: { id: "9" } }, res));
  assert.deepEqual(one.calls[0].params, ["2026-10-15", 9, 2]);
});
