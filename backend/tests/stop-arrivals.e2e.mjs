/**
 * Recording arrival at a stop.
 *
 * Arranges its own fixture: gives the demo driver's trip a stop, puts the trip
 * in transit, records the arrival, checks what was stored, and puts everything
 * back — including the stop it created.
 */
import "../src/config/env.js";
import db from "../src/config/db.js";
import { operatingScope } from "./_context.mjs";

const API = "http://localhost:5000";
let pass = 0, fail = 0;
const check = (n, c, x = "") => { if (c) { pass++; console.log(`ok    ${n}`); } else { fail++; console.log(`FAIL  ${n} ${x}`); } };

const [[trip]] = await db.execute(
  `SELECT tt.trip_ticket_id id, tt.ticket_no, tt.status
     FROM trip_assignments ta
     JOIN trip_tickets tt ON tt.trip_ticket_id = ta.trip_ticket_id
     JOIN drivers d ON d.driver_id = ta.driver_id
    WHERE d.employee_no = 'DRV-001' AND ta.is_current = TRUE
    ORDER BY tt.trip_ticket_id LIMIT 1`
);
if (!trip) { console.error("no trip assigned to DRV-001"); process.exit(2); }

const originalStatus = trip.status;
await db.execute("UPDATE trip_tickets SET status = 'in_transit' WHERE trip_ticket_id = ?", [trip.id]);

const [ins] = await db.execute(
  `INSERT INTO trip_stops (trip_ticket_id, stop_order, stop_type, location_name, latitude, longitude)
   VALUES (?, 99, 'waypoint', 'QA Waypoint — Digos', 6.7497, 125.3572)`,
  [trip.id]
);
const stopId = ins.insertId;

const cleanup = async () => {
  await db.execute("DELETE FROM trip_stops WHERE stop_id = ?", [stopId]);
  await db.execute("UPDATE trip_tickets SET status = ? WHERE trip_ticket_id = ?", [originalStatus, trip.id]);
};

try {
  const dl = await fetch(`${API}/api/v1/driver/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ employeeNo: "DRV-001", pin: "1234" }),
  });
  const dj = await dl.json();
  const H = { Authorization: `Bearer ${dj.data.token}`, "Content-Type": "application/json" };
  check("driver signs in", dl.ok && dj.data?.token);

  // the stop is visible, and not yet reached
  const before = await (await fetch(`${API}/api/v1/driver/trips/${trip.id}`, { headers: H })).json();
  const mine = (before.data?.stops || []).find((s) => s.id === stopId);
  check("the stop is listed for the driver", !!mine, JSON.stringify(before.data?.stops || []).slice(0, 120));
  check("it starts as not reached", mine && !mine.arrivedAt);

  // a stop that belongs to another trip is refused
  const wrong = await fetch(`${API}/api/v1/driver/trips/${trip.id}/stops/99999999/arrive`, {
    method: "POST", headers: H, body: JSON.stringify({}),
  });
  check("a stop not on this trip is refused", wrong.status === 404, `status=${wrong.status}`);

  // record the arrival
  const res = await fetch(`${API}/api/v1/driver/trips/${trip.id}/stops/${stopId}/arrive`, {
    method: "POST", headers: H,
    body: JSON.stringify({ lat: 6.7501, lng: 125.3560, note: "Gate closed, waited 10 min" }),
  });
  check("arrival is recorded", res.ok, `status=${res.status}`);

  const [[row]] = await db.execute("SELECT * FROM trip_stops WHERE stop_id = ?", [stopId]);
  check("arrival time stamped by the server", !!row.actual_arrival);
  check("position stored", Number(row.arrived_lat).toFixed(4) === "6.7501", String(row.arrived_lat));
  check("driver recorded", !!row.arrived_by_driver_id);
  check("note stored", /Gate closed/.test(row.arrival_note || ""), row.arrival_note);

  // arriving twice is a mis-tap, not an event
  const again = await fetch(`${API}/api/v1/driver/trips/${trip.id}/stops/${stopId}/arrive`, {
    method: "POST", headers: H, body: JSON.stringify({}),
  });
  check("arriving twice is refused", again.status === 409, `status=${again.status}`);

  // the driver sees it as reached
  const after = await (await fetch(`${API}/api/v1/driver/trips/${trip.id}`, { headers: H })).json();
  const now = (after.data?.stops || []).find((s) => s.id === stopId);
  check("the driver now sees it reached", !!now?.arrivedAt);

  // and so does staff
  const sl = await fetch(`${API}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "superadmin@gmail.com", password: "demo123" }),
  });
  const sj = await sl.json();
  const a = await operatingScope(sj.data.access, db);
  const SH = {
    Authorization: `Bearer ${sj.data.token}`,
    "X-Company-Id": String(a.company_id ?? ""),
    "X-Branch-Id": String(a.branch_id ?? ""),
  };
  const staff = await (await fetch(`${API}/api/v1/operations/trips/${trip.id}`, { headers: SH })).json();
  const staffStop = (staff.data?.stops || []).find((s) => s.stop_id === stopId);
  check("staff see the arrival on the trip", !!staffStop?.actual_arrival, JSON.stringify(staffStop || {}).slice(0, 120));

  // a stop cannot be recorded once the trip is no longer moving
  await db.execute("UPDATE trip_tickets SET status = 'delivered' WHERE trip_ticket_id = ?", [trip.id]);
  await db.execute("UPDATE trip_stops SET actual_arrival = NULL WHERE stop_id = ?", [stopId]);
  const late = await fetch(`${API}/api/v1/driver/trips/${trip.id}/stops/${stopId}/arrive`, {
    method: "POST", headers: H, body: JSON.stringify({}),
  });
  check("a stop cannot be logged after the run ends", late.status === 409, `status=${late.status}`);
} finally {
  await cleanup();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  await db.end();
  process.exitCode = fail ? 1 : 0;
}
