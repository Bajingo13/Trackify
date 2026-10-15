import "../../config/env.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import db from "../../config/db.js";
import router from "./driver.routes.js";
import { me } from "./driverProfile.controller.js";

/**
 * The licence is the office's record; the Driver App only shows it.
 *
 * Two things are pinned. The router has no way to write a licence from the app
 * (checked against the router itself, so a route added later by accident fails
 * here), and what the app shows is exactly what the office's columns hold, with
 * the state and days left decided by the server.
 */

const routesFor = (pathPart) =>
  router.stack
    .filter((layer) => layer.route && layer.route.path.includes(pathPart))
    .flatMap((layer) => Object.keys(layer.route.methods).map((m) => `${m.toUpperCase()} ${layer.route.path}`));

test("the app can read the licence photo and nothing else about the licence", () => {
  assert.deepEqual(routesFor("license"), ["GET /me/license-photo"]);
});

test("there is no route to scan, submit, replace or remove a licence from the app", () => {
  for (const p of ["/me/license", "/me/license-scan", "/me/licence"]) {
    assert.deepEqual(routesFor(p).filter((r) => !r.startsWith("GET /me/license-photo")), [], p);
  }
  // and nothing on /me writes licence fields: PATCH /me is phone and emergency contact only
  assert.ok(routesFor("/me").includes("PATCH /me"));
});

const ROW = {
  driver_id: 9, employee_no: "DRV-001", first_name: "Juan", last_name: "Dela Cruz", phone: null,
  license_no: "N01-12-345678", license_type: "Professional", license_expiry: "2020-01-01",
  emergency_contact_name: null, emergency_contact_phone: null, emergency_contact_relation: null,
  status: "active", created_at: new Date(), photo_path: null, photo_updated_at: null,
  license_photo_path: "licenses/2026/09/a.jpg", license_photo_updated_at: null,
  branch_name: "Davao", branch_code: "DVO", company_name: "AstreaBlue",
};

let real;
afterEach(() => { if (real) db.execute = real; real = null; });

async function profileFor(row) {
  real = db.execute;
  db.execute = async (sql) => (String(sql).includes("FROM drivers d") ? [[row]] : [[{ trips: 0, km: 0 }]]);
  let body;
  await me({ driver: { driverId: 9, companyId: 7 } }, { status() { return this; }, json(v) { body = v; } });
  return body.data.license;
}

test("the app shows exactly what the office recorded, with state and days from the server", async () => {
  const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const lic = await profileFor({ ...ROW, license_no: "T99-26-000417", license_type: "Student", license_expiry: day(20) });
  assert.equal(lic.no, "T99-26-000417");
  assert.equal(lic.type, "Student");
  assert.equal(lic.expiry, day(20));
  assert.equal(lic.state, "expiring");
  assert.ok(lic.daysLeft >= 19 && lic.daysLeft <= 21);
  assert.equal(lic.hasPhoto, true);
  assert.equal("pendingReview" in lic, false, "there is no driver-side submission to review any more");
});

test("a licence with no type recorded reads as Professional, as it does in the office screens", async () => {
  assert.equal((await profileFor({ ...ROW, license_type: null })).type, "Professional");
  assert.equal((await profileFor({ ...ROW, license_type: "Student" })).type, "Student");
  assert.equal((await profileFor({ ...ROW, license_type: null, license_no: null })).type, null);
});

test("expired and missing licences are said so", async () => {
  assert.equal((await profileFor(ROW)).state, "expired");
  real = null; // restored by afterEach each time; profileFor re-stubs
  const none = await profileFor({ ...ROW, license_expiry: null });
  assert.equal(none.state, "none");
  assert.equal(none.daysLeft, null);
});
