/**
 * Proof of delivery, end to end.
 *
 * Arranges its own fixture: puts a trip into in_transit for the demo driver,
 * confirms delivery with a receiver, a note, a position and a photo, then
 * checks what was actually stored — and puts the trip back afterwards.
 */
import "../src/config/env.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import db from "../src/config/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API = "http://localhost:5000";
const PHOTO = fs.readFileSync(path.join(__dirname, "receipt.png"));

let pass = 0, fail = 0;
const check = (n, c, x = "") => { if (c) { pass++; console.log(`ok    ${n}`); } else { fail++; console.log(`FAIL  ${n} ${x}`); } };

// ---- fixture: a trip the demo driver is on, forced to in_transit ----
const [[trip]] = await db.execute(
  `SELECT tt.trip_ticket_id id, tt.ticket_no, tt.status
     FROM trip_assignments ta
     JOIN trip_tickets tt ON tt.trip_ticket_id = ta.trip_ticket_id
     JOIN drivers d ON d.driver_id = ta.driver_id
    WHERE d.employee_no = 'DRV-001' AND ta.is_current = TRUE
    ORDER BY tt.trip_ticket_id LIMIT 1`
);
if (!trip) { console.error("no trip assigned to DRV-001"); process.exit(2); }

const original = trip.status;
await db.execute("UPDATE trip_tickets SET status = 'in_transit' WHERE trip_ticket_id = ?", [trip.id]);
await db.execute("DELETE FROM trip_pod WHERE trip_ticket_id = ?", [trip.id]);

const restore = async () => {
  await db.execute("DELETE FROM trip_pod WHERE trip_ticket_id = ?", [trip.id]);
  await db.execute("UPDATE trip_tickets SET status = ? WHERE trip_ticket_id = ?", [original, trip.id]);
};

try {
  const dl = await fetch(`${API}/api/v1/driver/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ employeeNo: "DRV-001", pin: "1234" }),
  });
  const dj = await dl.json();
  check("driver signs in", dl.ok && dj.data?.token);
  const H = { Authorization: `Bearer ${dj.data.token}` };

  // ---- a receiver name is required ----
  const empty = new FormData();
  const noName = await fetch(`${API}/api/v1/driver/trips/${trip.id}/deliver`, { method: "POST", headers: H, body: empty });
  check("delivery without a receiver is refused", noName.status === 400, `status=${noName.status}`);

  // ---- confirm properly ----
  const form = new FormData();
  form.set("receivedBy", "Marites Bautista");
  form.set("note", "2 crates short, noted on the waybill");
  form.set("lat", "7.0731");
  form.set("lng", "125.6128");
  form.set("photo", new Blob([PHOTO], { type: "image/png" }), "pod.png");

  const res = await fetch(`${API}/api/v1/driver/trips/${trip.id}/deliver`, { method: "POST", headers: H, body: form });
  const body = await res.json();
  check("delivery is confirmed", res.ok && body.data?.status === "delivered", JSON.stringify(body).slice(0, 140));

  // ---- what was stored ----
  const [[pod]] = await db.execute("SELECT * FROM trip_pod WHERE trip_ticket_id = ?", [trip.id]);
  check("POD row written", !!pod);
  check("receiver recorded", pod?.received_by === "Marites Bautista", pod?.received_by);
  check("note recorded", /2 crates short/.test(pod?.note || ""), pod?.note);
  check("capture position recorded", Number(pod?.captured_lat).toFixed(4) === "7.0731", String(pod?.captured_lat));
  check("capture time recorded", !!pod?.captured_at);
  check("driver recorded", !!pod?.driver_id);
  check("photo stored on disk", !!pod?.photo_path && fs.existsSync(path.resolve(__dirname, "../uploads", pod.photo_path)));

  // ---- the photo is served back to its driver ----
  const img = await fetch(`${API}/api/v1/driver/trips/${trip.id}/pod-photo`, { headers: H });
  const bytes = Buffer.from(await img.arrayBuffer());
  check("photo downloads intact", img.ok && bytes.equals(PHOTO), `status=${img.status} len=${bytes.length}`);

  const anon = await fetch(`${API}/api/v1/driver/trips/${trip.id}/pod-photo`);
  check("photo refuses anonymous access", anon.status === 401, `status=${anon.status}`);

  // ---- one POD per trip ----
  await db.execute("UPDATE trip_tickets SET status = 'in_transit' WHERE trip_ticket_id = ?", [trip.id]);
  const again = new FormData();
  again.set("receivedBy", "Someone Else");
  const dupe = await fetch(`${API}/api/v1/driver/trips/${trip.id}/deliver`, { method: "POST", headers: H, body: again });
  check("a second POD for the same trip is rejected", !dupe.ok, `status=${dupe.status}`);

  const [[count]] = await db.execute("SELECT COUNT(*) n FROM trip_pod WHERE trip_ticket_id = ?", [trip.id]);
  check("still exactly one POD", Number(count.n) === 1, String(count.n));
} finally {
  await restore();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  await db.end();
  process.exitCode = fail ? 1 : 0;
}
