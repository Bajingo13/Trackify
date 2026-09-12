/**
 * Does closing a trip move the vehicle's odometer, and by how much?
 *
 * Arranges a delivered trip, records the vehicle's reading, closes the trip
 * through the API, and compares. Restores everything afterwards.
 */
import "../src/config/env.js";
import db from "../src/config/db.js";
import { operatingScope } from "./_context.mjs";

const API = "http://localhost:5000";
let pass = 0, fail = 0;
const check = (n, c, x = "") => { if (c) { pass++; console.log(`ok    ${n}`); } else { fail++; console.log(`FAIL  ${n} ${x}`); } };

const [[trip]] = await db.execute(
  `SELECT tt.trip_ticket_id id, tt.ticket_no, tt.status, tt.route_distance_km,
          ta.vehicle_id, v.plate_no, v.odometer
     FROM trip_tickets tt
     JOIN trip_assignments ta ON ta.trip_ticket_id = tt.trip_ticket_id AND ta.is_current = TRUE
     JOIN vehicles v ON v.vehicle_id = ta.vehicle_id
    WHERE tt.route_distance_km IS NOT NULL
    ORDER BY tt.trip_ticket_id DESC LIMIT 1`
);
if (!trip) { console.error("no assigned trip with a route"); process.exit(2); }

const originalStatus = trip.status;
const before = Number(trip.odometer);
const planned = Number(trip.route_distance_km);

const [pings] = await db.execute(
  "SELECT COUNT(*) n FROM trip_tracking_points WHERE trip_ticket_id = ?",
  [trip.id]
);

console.log(`      ${trip.ticket_no} on ${trip.plate_no}`);
console.log(`      planned route ${planned} km · ${pings[0].n} GPS pings · odometer ${before} km\n`);

await db.execute("UPDATE trip_tickets SET status = 'delivered' WHERE trip_ticket_id = ?", [trip.id]);

const cleanup = async () => {
  await db.execute("UPDATE trip_tickets SET status = ? WHERE trip_ticket_id = ?", [originalStatus, trip.id]);
  await db.execute("UPDATE vehicles SET odometer = ? WHERE vehicle_id = ?", [before, trip.vehicle_id]);
  await db.execute(
    "DELETE FROM trip_status_history WHERE trip_ticket_id = ? AND action = 'CLOSE_TRIP' AND changed_by IS NOT NULL",
    [trip.id]
  );
};

try {
  const sj = await (await fetch(`${API}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "superadmin@gmail.com", password: "demo123" }),
  })).json();
  const a = await operatingScope(sj.data.access, db);
  const H = {
    Authorization: `Bearer ${sj.data.token}`,
    "X-Company-Id": String(a.company_id),
    "X-Branch-Id": String(a.branch_id),
    "Content-Type": "application/json",
  };

  const res = await fetch(`${API}/api/v1/operations/trips/${trip.id}/close`, { method: "POST", headers: H, body: "{}" });
  check("trip closes", res.ok, `status=${res.status}`);

  const [[after]] = await db.execute("SELECT odometer FROM vehicles WHERE vehicle_id = ?", [trip.vehicle_id]);
  const added = Number(after.odometer) - before;

  console.log(`      odometer ${before} -> ${Number(after.odometer)}  (+${added.toFixed(1)} km)\n`);

  check("the odometer moved", added > 0, `added ${added}`);
  check(
    "it added roughly the planned distance",
    Math.abs(added - planned) < Math.max(1, planned * 0.05),
    `added ${added.toFixed(1)} vs planned ${planned}`
  );

  // closing again must not add a second time
  const again = await fetch(`${API}/api/v1/operations/trips/${trip.id}/close`, { method: "POST", headers: H, body: "{}" });
  const [[after2]] = await db.execute("SELECT odometer FROM vehicles WHERE vehicle_id = ?", [trip.vehicle_id]);
  check("closing twice is refused", !again.ok, `status=${again.status}`);
  check("and the odometer is not double counted", Number(after2.odometer) === Number(after.odometer),
    `${after.odometer} -> ${after2.odometer}`);
} finally {
  await cleanup();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  await db.end();
  process.exitCode = fail ? 1 : 0;
}
