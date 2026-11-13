import test from "node:test";
import assert from "node:assert/strict";
import { buildRecommendations, distanceKm, recommendDrivers, recommendVehicles } from "./dispatchRecommendations.js";

const trip = { id: 5, branchId: 2, originLat: 14.55, originLng: 121.02, cargoWeight: 4000, requiredVehicleType: "Box Truck" };

test("distance uses an internal great-circle calculation and needs complete coordinates", () => {
  assert.ok(distanceKm(14.55, 121.02, 14.60, 121.02) > 5);
  assert.equal(distanceKm(null, 121, 14, 121), null);
});

test("drivers are ranked by branch, fresh proximity and recent workload with explanations", () => {
  const now = new Date("2026-11-10T04:00:00Z").getTime();
  const rows = recommendDrivers(trip, [
    { id: 1, name: "Busy Far", homeBranchId: 2, lastLat: 15.2, lastLng: 121.3, lastLocationAt: "2026-11-10T03:00:00Z", recentTripCount: 5 },
    { id: 2, name: "Ready Near", homeBranchId: 2, lastLat: 14.56, lastLng: 121.02, lastLocationAt: "2026-11-10T03:00:00Z", recentTripCount: 0 },
  ], { now });
  assert.equal(rows[0].id, 2);
  assert.equal(rows[0].rank, 1);
  assert.ok(rows[0].score > rows[1].score);
  assert.match(rows[0].reasons.join(" "), /km from pickup/);
});

test("stale location is disclosed and does not masquerade as a live position", () => {
  const [row] = recommendDrivers(trip, [
    { id: 1, name: "Driver", homeBranchId: 2, lastLat: 14.55, lastLng: 121.02, lastLocationAt: "2026-11-01T00:00:00Z" },
  ], { now: new Date("2026-11-10T00:00:00Z").getTime() });
  assert.equal(row.distanceKm, null);
  assert.match(row.reasons.join(" "), /No recent operational location/);
});

test("vehicles that miss capacity or required type remain visible but are not recommendable", () => {
  const rows = recommendVehicles(trip, [
    { id: 1, plateNo: "GOOD", type: "Box Truck", capacity: 5000, homeBranchId: 2 },
    { id: 2, plateNo: "SMALL", type: "Box Truck", capacity: 3000, homeBranchId: 2 },
    { id: 3, plateNo: "WRONG", type: "Tanker", capacity: 9000, homeBranchId: 2 },
  ]);
  assert.equal(rows[0].plateNo, "GOOD");
  assert.equal(rows[0].eligible, true);
  assert.equal(rows.find((r) => r.plateNo === "SMALL").eligible, false);
  assert.equal(rows.find((r) => r.plateNo === "WRONG").eligible, false);
});

test("the result publishes its deterministic scoring version and weights", () => {
  const result = buildRecommendations({ trip, drivers: [], vehicles: [] });
  assert.equal(result.version, "free-rules-v1");
  assert.equal(result.weights.driver.proximity, 25);
  assert.equal(result.weights.vehicle.capacity, 30);
});
