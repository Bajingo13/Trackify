/**
 * Can a busy driver or vehicle be assigned?
 *
 * The dropdown only lists free resources, but a dropdown is not a control.
 * This checks the server refuses a busy driver or vehicle even when the
 * request names one directly — and that the listing agrees with the rule.
 */
import "../src/config/env.js";
import db from "../src/config/db.js";
import { operatingScope } from "./_context.mjs";

const API = "http://localhost:5000";
let pass = 0, fail = 0;
const check = (n, c, x = "") => { if (c) { pass++; console.log(`ok    ${n}`); } else { fail++; console.log(`FAIL  ${n} ${x}`); } };

const r = await fetch(`${API}/api/auth/login`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "superadmin@gmail.com", password: "demo123" }),
});
const j = await r.json();
const a = await operatingScope(j.data.access, db);
const H = {
  Authorization: `Bearer ${j.data.token}`,
  "X-Company-Id": String(a.company_id ?? ""),
  "X-Branch-Id": String(a.branch_id ?? ""),
  "Content-Type": "application/json",
};

// a driver and vehicle currently out on a running trip
const [[busy]] = await db.execute(
  `SELECT ta.driver_id, ta.vehicle_id, tt.ticket_no, tt.status,
          CONCAT(d.first_name,' ',d.last_name) driver, v.plate_no
     FROM trip_assignments ta
     JOIN trip_tickets tt ON tt.trip_ticket_id = ta.trip_ticket_id
     JOIN drivers d ON d.driver_id = ta.driver_id
     JOIN vehicles v ON v.vehicle_id = ta.vehicle_id
    WHERE ta.is_current = TRUE AND tt.status = 'in_transit' LIMIT 1`
);
if (!busy) { console.error("no in-transit trip to test against"); process.exit(2); }
console.log(`      busy: ${busy.driver} + ${busy.plate_no} on ${busy.ticket_no} (${busy.status})\n`);

// A trip that still needs resources. The demo usually has none — every
// approved trip is already dispatched — so one is borrowed for the test and
// put back afterwards, rather than letting the real checks silently skip.
let [[target]] = await db.execute(
  `SELECT tt.trip_ticket_id id, tt.ticket_no
     FROM trip_tickets tt
    WHERE tt.status = 'approved'
      AND NOT EXISTS (SELECT 1 FROM trip_assignments ta
                       WHERE ta.trip_ticket_id = tt.trip_ticket_id AND ta.is_current = TRUE)
    LIMIT 1`
);

let borrowed = null;
if (!target) {
  const [[candidate]] = await db.execute(
    `SELECT tt.trip_ticket_id id, tt.ticket_no, tt.status
       FROM trip_tickets tt
      WHERE tt.status IN ('for_approval', 'for_validation', 'draft')
        AND NOT EXISTS (SELECT 1 FROM trip_assignments ta
                         WHERE ta.trip_ticket_id = tt.trip_ticket_id AND ta.is_current = TRUE)
      LIMIT 1`
  );
  if (candidate) {
    borrowed = { id: candidate.id, status: candidate.status };
    await db.execute("UPDATE trip_tickets SET status = 'approved' WHERE trip_ticket_id = ?", [candidate.id]);
    target = { id: candidate.id, ticket_no: candidate.ticket_no };
    console.log(`      borrowed ${candidate.ticket_no} (was ${candidate.status}) as the assignment target
`);
  }
}

// ---- the listing must not offer them ----
const avail = await (await fetch(`${API}/api/v1/fleet/availability`, { headers: H })).json();
const freeDrivers = (avail.data?.drivers || []).filter((d) => d.availability === "available");
const freeVehicles = (avail.data?.vehicles || []).filter((v) => v.availability === "available");

check("busy driver is not listed as available",
  !freeDrivers.some((d) => d.driver_id === busy.driver_id),
  `${busy.driver} appeared in the free list`);
check("busy vehicle is not listed as available",
  !freeVehicles.some((v) => v.vehicle_id === busy.vehicle_id),
  `${busy.plate_no} appeared in the free list`);

// ---- and the server must refuse them even when named directly ----
if (!target) {
  console.log("      (no unassigned approved trip — skipping the direct-assign checks)");
} else {
  const free = freeDrivers[0];
  const freeV = freeVehicles[0];

  const attempt = (driverId, vehicleId) =>
    fetch(`${API}/api/v1/operations/dispatch/trips/${target.id}/assign`, {
      method: "POST", headers: H,
      body: JSON.stringify({ driverId, vehicleId }),
    });

  const r1 = await attempt(busy.driver_id, freeV?.vehicle_id);
  check("assigning a busy driver is refused", r1.status === 409, `status=${r1.status}`);

  const r2 = await attempt(free?.driver_id, busy.vehicle_id);
  check("assigning a busy vehicle is refused", r2.status === 409, `status=${r2.status}`);

  const [[still]] = await db.execute(
    "SELECT COUNT(*) n FROM trip_assignments WHERE trip_ticket_id = ? AND is_current = TRUE",
    [target.id]
  );
  check("the target trip is still unassigned", Number(still.n) === 0, `assignments=${still.n}`);
}

// ---- an expired licence is ineligible regardless of being free ----
const [[anyFree]] = await db.execute(
  `SELECT driver_id, license_expiry FROM drivers WHERE status='active' ORDER BY driver_id LIMIT 1`
);
if (target && anyFree) {
  const original = anyFree.license_expiry;
  await db.execute("UPDATE drivers SET license_expiry = '2020-01-01' WHERE driver_id = ?", [anyFree.driver_id]);
  const res = await fetch(`${API}/api/v1/operations/dispatch/trips/${target.id}/assign`, {
    method: "POST", headers: H,
    body: JSON.stringify({ driverId: anyFree.driver_id, vehicleId: freeVehicles[0]?.vehicle_id }),
  });
  check("a driver with an expired licence is refused", res.status === 409, `status=${res.status}`);
  await db.execute("UPDATE drivers SET license_expiry = ? WHERE driver_id = ?", [original, anyFree.driver_id]);
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
await db.end();
process.exitCode = fail ? 1 : 0;
