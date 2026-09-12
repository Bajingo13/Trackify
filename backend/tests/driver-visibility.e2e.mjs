/**
 * What the driver does, the dispatcher can see.
 *
 * Confirms a delivery and reaches a stop as the driver, then checks that staff
 * get the proof of delivery on the trip, can fetch its photo, and find the stop
 * arrival on the timeline. Arranges and restores its own fixture.
 */
import "../src/config/env.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import db from "../src/config/db.js";
import { operatingScope } from "./_context.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API = "http://localhost:5000";
const PHOTO = fs.readFileSync(path.join(__dirname, "receipt.png"));

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
if (!trip) { console.error("no trip for DRV-001"); process.exit(2); }

const originalStatus = trip.status;
await db.execute("UPDATE trip_tickets SET status = 'in_transit' WHERE trip_ticket_id = ?", [trip.id]);
await db.execute("DELETE FROM trip_pod WHERE trip_ticket_id = ?", [trip.id]);
const [ins] = await db.execute(
  `INSERT INTO trip_stops (trip_ticket_id, stop_order, stop_type, location_name, latitude, longitude)
   VALUES (?, 98, 'waypoint', 'QA Visibility Stop', 7.05, 125.5)`,
  [trip.id]
);
const stopId = ins.insertId;

const cleanup = async () => {
  await db.execute("DELETE FROM trip_status_history WHERE trip_ticket_id = ? AND action = 'STOP_ARRIVED'", [trip.id]);
  await db.execute("DELETE FROM trip_stops WHERE stop_id = ?", [stopId]);
  await db.execute("DELETE FROM trip_pod WHERE trip_ticket_id = ?", [trip.id]);
  await db.execute("UPDATE trip_tickets SET status = ? WHERE trip_ticket_id = ?", [originalStatus, trip.id]);
};

try {
  const dj = await (await fetch(`${API}/api/v1/driver/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ employeeNo: "DRV-001", pin: "1234" }),
  })).json();
  const DH = { Authorization: `Bearer ${dj.data.token}` };

  // ---- driver reaches a stop ----
  const arrive = await fetch(`${API}/api/v1/driver/trips/${trip.id}/stops/${stopId}/arrive`, {
    method: "POST", headers: { ...DH, "Content-Type": "application/json" },
    body: JSON.stringify({ lat: 7.0505, lng: 125.5005, note: "Guard signed the logbook" }),
  });
  check("driver records the stop", arrive.ok, `status=${arrive.status}`);

  // ---- driver confirms delivery ----
  const form = new FormData();
  form.set("receivedBy", "Ligaya Ramos");
  form.set("note", "Left at the receiving bay");
  form.set("lat", "7.0510");
  form.set("lng", "125.5012");
  form.set("photo", new Blob([PHOTO], { type: "image/png" }), "pod.png");
  const deliver = await fetch(`${API}/api/v1/driver/trips/${trip.id}/deliver`, { method: "POST", headers: DH, body: form });
  check("driver confirms delivery", deliver.ok, `status=${deliver.status}`);

  // ---- staff side ----
  const sj = await (await fetch(`${API}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "superadmin@gmail.com", password: "demo123" }),
  })).json();
  const a = await operatingScope(sj.data.access, db);
  const SH = {
    Authorization: `Bearer ${sj.data.token}`,
    "X-Company-Id": String(a.company_id),
    "X-Branch-Id": String(a.branch_id),
  };

  const detail = await (await fetch(`${API}/api/v1/operations/trips/${trip.id}`, { headers: SH })).json();
  const d = detail.data || {};

  check("staff see the proof of delivery", !!d.pod, JSON.stringify(Object.keys(d)).slice(0, 120));
  check("it names who received it", d.pod?.received_by === "Ligaya Ramos", d.pod?.received_by);
  check("it carries the capture position", d.pod?.captured_lat != null);
  check("it reports a photo exists", !!Number(d.pod?.has_photo));
  check("it names the driver", !!d.pod?.driver_name, d.pod?.driver_name);

  const img = await fetch(`${API}/api/v1/operations/trips/${trip.id}/pod-photo`, { headers: SH });
  const bytes = Buffer.from(await img.arrayBuffer());
  check("staff can open the photo", img.ok && bytes.equals(PHOTO), `status=${img.status} len=${bytes.length}`);

  const anon = await fetch(`${API}/api/v1/operations/trips/${trip.id}/pod-photo`);
  check("the photo refuses anonymous access", anon.status === 401, `status=${anon.status}`);

  // ---- the timeline tells the story ----
  const events = d.history || [];
  check("the stop arrival is on the timeline", events.some((e) => e.action === "STOP_ARRIVED"),
    events.map((e) => e.action).join(",").slice(0, 120));
  check("the arrival note is on the timeline",
    events.some((e) => /Guard signed the logbook/.test(e.remarks || "")));
  check("the delivery is on the timeline", events.some((e) => e.action === "CONFIRM_DELIVERY"));
} finally {
  await cleanup();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  await db.end();
  process.exitCode = fail ? 1 : 0;
}
