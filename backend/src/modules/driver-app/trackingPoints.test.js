import "../../config/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import db from "../../config/db.js";
import { ping, trail } from "./driver.controller.js";
import {
  insertPoint, movesLiveMap, readPoint, trailRejection,
  LIVE_MAX_AGE_S, TRAIL_BATCH_MAX, TRAIL_MAX_AGE_S, WINDOW_EDGE_S,
} from "./trackingPoints.js";

const REF = "fix-0123456789abcdef";
const DRIVER = { driverId: 9, companyId: 7, branchId: 111 };

function capture() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}

/** db.execute standing in for one trip; inserts land in `rows`, and a repeated client_ref is a duplicate key. */
function withTrip(trip, fn, { missingColumns = false } = {}) {
  const saved = db.execute;
  const rows = [];
  db.execute = async (sql, params) => {
    if (sql.includes("FROM trip_assignments")) return [trip ? [trip] : []];
    if (sql.includes("INSERT INTO trip_tracking_points")) {
      if (missingColumns && sql.includes("client_ref")) {
        throw Object.assign(new Error("Unknown column 'client_ref'"), { code: "ER_BAD_FIELD_ERROR" });
      }
      const hasRef = sql.includes("client_ref");
      const ref = hasRef ? params[10] : null;
      if (ref && rows.some((r) => r.driverId === params[3] && r.ref === ref)) {
        throw Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY" });
      }
      rows.push({ sql, params, driverId: params[3], ref, source: hasRef ? params[12] : "legacy", ageS: hasRef ? params[11] : params[10] });
      return [{ insertId: rows.length }];
    }
    throw new Error(`Unexpected query: ${sql}`);
  };
  return Promise.resolve(fn(rows)).finally(() => { db.execute = saved; });
}

const point = (n, extra = {}) => ({ lat: 7.07 + n / 1000, lng: 125.6, accuracyMeters: 12, clientRef: `${REF}-${n}`, ageMs: 600000, ...extra });
const onTheRoad = { vehicle_id: 77, status: "in_transit", branch_id: 222, sinceDeparture: 3 * 3600, sinceArrival: null };

/* ---------------------------------------------------------------- */
/* Reading a point                                                  */
/* ---------------------------------------------------------------- */

test("a reading is read with its age, its own name, and nothing off the globe", () => {
  const { point: p } = readPoint({ lat: "7.07", lng: 125.6, speedKph: "40", accuracyMeters: 8, clientRef: REF, ageMs: 90500 });
  assert.equal(p.lat, 7.07);
  assert.equal(p.speedKph, 40);
  assert.equal(p.clientRef, REF);
  assert.equal(p.ageS, 91);
  assert.equal(readPoint({ lat: 91, lng: 0 }).error, "lat must be between -90 and 90, and lng between -180 and 180.");
  assert.equal(readPoint({ lng: 0 }).error, "lat and lng are required.");
  // an earlier build named the age queuedForMs
  assert.equal(readPoint({ lat: 1, lng: 1, queuedForMs: 120000 }).point.ageS, 120);
  // a name that is not one is no name
  assert.equal(readPoint({ lat: 1, lng: 1, clientRef: "x; DROP" }).point.clientRef, null);
});

test("a recovered point must fall inside the trip's own time on the road", () => {
  const ok = { clientRef: REF, ageS: 600, accuracyMeters: 10 };
  assert.equal(trailRejection(ok, onTheRoad), null);
  assert.equal(trailRejection({ ...ok, clientRef: null }, onTheRoad), "missing clientRef");
  assert.equal(trailRejection({ ...ok, ageS: null }, onTheRoad), "missing or negative age");
  assert.equal(trailRejection({ ...ok, ageS: -5 }, onTheRoad), "missing or negative age");
  assert.equal(trailRejection({ ...ok, ageS: TRAIL_MAX_AGE_S + 1 }, { ...onTheRoad, sinceDeparture: null }), "too old");
  assert.equal(trailRejection({ ...ok, accuracyMeters: 900 }, onTheRoad), "too inaccurate");
  // departed three hours ago: three hours and six minutes ago is before it
  assert.equal(trailRejection({ ...ok, ageS: 3 * 3600 + WINDOW_EDGE_S + 1 }, onTheRoad), "before the trip started");
  assert.equal(trailRejection({ ...ok, ageS: 3 * 3600 + WINDOW_EDGE_S }, onTheRoad), null);
  // delivered an hour ago: ten minutes ago is after it
  const delivered = { ...onTheRoad, status: "delivered", sinceArrival: 3600 };
  assert.equal(trailRejection({ ...ok, ageS: 600 }, delivered), "after the trip was delivered");
  assert.equal(trailRejection({ ...ok, ageS: 3600 + 60 }, delivered), null);
});

test("only a fresh fix moves dispatch's live map", () => {
  assert.equal(movesLiveMap(0), true);
  assert.equal(movesLiveMap(120), true);
  assert.equal(movesLiveMap(121), false);
});

/* ---------------------------------------------------------------- */
/* The live ping                                                    */
/* ---------------------------------------------------------------- */

test("a live ping that waited in the outbox is stored at the time it was taken, not when it arrived", async () => {
  await withTrip(onTheRoad, async (rows) => {
    const res = capture();
    await ping({ params: { id: "55" }, body: { lat: 7.07, lng: 125.6, clientRef: REF, ageMs: 5 * 60 * 1000 }, driver: DRIVER }, res);
    assert.equal(res.statusCode, 201);
    assert.deepEqual(res.body, { success: true });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].ageS, 300);
    assert.equal(rows[0].source, "live");
    assert.match(rows[0].sql, /NOW\(\) - INTERVAL \? SECOND/);
  });
});

test("a live ping from an older build, with no age or name, is stored as before", async () => {
  await withTrip(onTheRoad, async (rows) => {
    const res = capture();
    await ping({ params: { id: "55" }, body: { lat: 7.07, lng: 125.6 }, driver: DRIVER }, res);
    assert.equal(res.statusCode, 201);
    assert.equal(rows[0].ageS, 0);
    assert.equal(rows[0].ref, null);
  });
});

test("a live ping's age is capped, and a phone claiming a negative one gets now", async () => {
  await withTrip(onTheRoad, async (rows) => {
    await ping({ params: { id: "55" }, body: { lat: 7, lng: 125, ageMs: 10 * 3600 * 1000 }, driver: DRIVER }, capture());
    await ping({ params: { id: "55" }, body: { lat: 7, lng: 125, ageMs: -60000 }, driver: DRIVER }, capture());
    assert.equal(rows[0].ageS, LIVE_MAX_AGE_S);
    assert.equal(rows[1].ageS, 0);
  });
});

test("the same live ping sent twice is stored once", async () => {
  await withTrip(onTheRoad, async (rows) => {
    const body = { lat: 7.07, lng: 125.6, clientRef: REF };
    await ping({ params: { id: "55" }, body, driver: DRIVER }, capture());
    const again = capture();
    await ping({ params: { id: "55" }, body, driver: DRIVER }, again);
    assert.equal(rows.length, 1);
    assert.equal(again.statusCode, 200);
    assert.deepEqual(again.body, { success: true, duplicate: true });
  });
});

test("before migration 059, a live ping is still stored the old way", async () => {
  await withTrip(onTheRoad, async (rows) => {
    const res = capture();
    await ping({ params: { id: "55" }, body: { lat: 7.07, lng: 125.6, clientRef: REF, ageMs: 30000 }, driver: DRIVER }, res);
    assert.equal(res.statusCode, 201);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].source, "legacy");
    assert.equal(rows[0].ageS, 30);
  }, { missingColumns: true });
});

/* ---------------------------------------------------------------- */
/* The recovered trail                                              */
/* ---------------------------------------------------------------- */

test("a recovered trail answers each point: accepted, duplicate or rejected", async () => {
  await withTrip(onTheRoad, async (rows) => {
    const res = capture();
    const points = [point(1), point(2), point(1), point(3, { accuracyMeters: 2000 }), point(4, { clientRef: undefined })];
    await trail({ params: { id: "55" }, body: { points }, driver: DRIVER }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.accepted, 2);
    assert.equal(res.body.data.duplicate, 1);
    assert.equal(res.body.data.rejected, 2);
    assert.deepEqual(res.body.data.results.map((r) => r.result), ["accepted", "accepted", "duplicate", "rejected", "rejected"]);
    assert.equal(res.body.data.results[3].reason, "too inaccurate");
    assert.ok(rows.every((r) => r.source === "recovered"));
    assert.ok(rows.every((r) => r.ageS === 600), "stored at capture time, not arrival");
  });
});

test("the same batch sent again stores nothing new", async () => {
  await withTrip(onTheRoad, async (rows) => {
    const body = { points: [point(1), point(2)] };
    await trail({ params: { id: "55" }, body, driver: DRIVER }, capture());
    const again = capture();
    await trail({ params: { id: "55" }, body, driver: DRIVER }, again);
    assert.equal(rows.length, 2);
    assert.equal(again.body.data.duplicate, 2);
  });
});

test("a delivered run still takes the stretch driven out of signal before delivery", async () => {
  const delivered = { ...onTheRoad, status: "delivered", sinceArrival: 1800 };
  await withTrip(delivered, async (rows) => {
    const res = capture();
    await trail({ params: { id: "55" }, body: { points: [point(1, { ageMs: 45 * 60 * 1000 }), point(2, { ageMs: 60 * 1000 })] }, driver: DRIVER }, res);
    assert.equal(res.body.data.accepted, 1);
    assert.equal(res.body.data.results[1].reason, "after the trip was delivered");
    assert.equal(rows.length, 1);
  });
});

test("someone else's trip, or one never on the road, takes no trail", async () => {
  await withTrip(null, async (rows) => {
    const res = capture();
    await trail({ params: { id: "55" }, body: { points: [point(1)] }, driver: DRIVER }, res);
    assert.equal(res.statusCode, 404);
    assert.equal(rows.length, 0);
  });
  await withTrip({ ...onTheRoad, status: "assigned" }, async (rows) => {
    const res = capture();
    await trail({ params: { id: "55" }, body: { points: [point(1)] }, driver: DRIVER }, res);
    assert.equal(res.statusCode, 409);
    assert.equal(rows.length, 0);
  });
});

test("an empty or oversized batch is refused before anything is read", async () => {
  await withTrip(onTheRoad, async (rows) => {
    for (const body of [{}, { points: [] }, { points: "x" }, { points: Array.from({ length: TRAIL_BATCH_MAX + 1 }, (_, i) => point(i)) }]) {
      const res = capture();
      // eslint-disable-next-line no-await-in-loop
      await trail({ params: { id: "55" }, body, driver: DRIVER }, res);
      assert.equal(res.statusCode, 400);
    }
    assert.equal(rows.length, 0);
  });
});

test("before migration 059, a recovered trail is answered 503, so the phone keeps it", async () => {
  await withTrip(onTheRoad, async (rows) => {
    const res = capture();
    await trail({ params: { id: "55" }, body: { points: [point(1)] }, driver: DRIVER }, res);
    assert.equal(res.statusCode, 503);
    assert.equal(rows.length, 0);
  }, { missingColumns: true });
});

test("a recovered trail never reaches dispatch's live map", async () => {
  const source = await fs.readFile(new URL("./driver.controller.js", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("export async function trail("), source.indexOf("/* Driver-side transitions"));
  assert.ok(body.length > 100, "trail handler not found");
  assert.doesNotMatch(body, /publish\(/);
});

test("other database failures are not taken for duplicates", async () => {
  const runner = { execute: async () => { throw Object.assign(new Error("gone"), { code: "PROTOCOL_CONNECTION_LOST" }); } };
  await assert.rejects(
    () => insertPoint(runner, { companyId: 7, branchId: 1, tripId: 55, driverId: 9, vehicleId: 1, point: readPoint(point(1)).point, ageS: 0, source: "recovered" }),
    /gone/
  );
});
