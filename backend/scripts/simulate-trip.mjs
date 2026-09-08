/**
 * Drive a trip along its own route, so live tracking can be shown without a
 * phone in someone's pocket.
 *
 * It walks the road geometry the router already returned for the trip and
 * posts real GPS pings to the real driver endpoint at a chosen speed. Nothing
 * is written straight to the database: every position travels the same path a
 * driver's phone uses, so the WebSocket broadcast, the trail, the stop
 * detection and the odometer all behave exactly as they would in the field.
 *
 * The token is minted locally rather than by signing in, because each demo
 * driver has their own PIN and a script should not need to know them. This is
 * a development tool that already holds the database credentials and the
 * signing secret; it grants itself nothing it could not otherwise reach.
 *
 *   npm run demo:drive -- --trip DVO-2026-0018
 *   npm run demo:drive -- --trip DVO-2026-0018 --speed 80 --interval 2
 *   npm run demo:drive -- --list
 *
 * Ctrl+C stops it. The trip is left exactly where it was.
 */
import "../src/config/env.js";
import jwt from "jsonwebtoken";
import db from "../src/config/db.js";

const args = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const API = process.env.SIM_API || `http://localhost:${process.env.PORT || 5000}`;
const SPEED_KPH = Number(arg("speed", 60));
const INTERVAL_S = Number(arg("interval", 3));
const LOOP = flag("loop");

const R = 6371;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

function km(a, b) {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(rad(a.lat)) * Math.cos(rad(b.lat));
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Point `t` of the way from a to b, and the bearing travelled. */
function between(a, b, t) {
  const lat = a.lat + (b.lat - a.lat) * t;
  const lng = a.lng + (b.lng - a.lng) * t;
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return { lat, lng, heading: Math.round((deg(Math.atan2(y, x)) + 360) % 360) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const trackable = `
  SELECT tt.trip_ticket_id id, tt.ticket_no, tt.status, tt.company_id,
         tt.route_geometry, tt.route_distance_km,
         d.driver_id, d.employee_no, CONCAT(d.first_name,' ',d.last_name) driver,
         v.plate_no
    FROM trip_tickets tt
    JOIN trip_assignments ta ON ta.trip_ticket_id = tt.trip_ticket_id AND ta.is_current = TRUE
    JOIN drivers d ON d.driver_id = ta.driver_id
    JOIN vehicles v ON v.vehicle_id = ta.vehicle_id
   WHERE tt.status IN ('released','in_transit') AND tt.route_geometry IS NOT NULL`;

const [rows] = await db.query(`${trackable} ORDER BY tt.trip_ticket_id`);

if (flag("list") || !rows.length) {
  if (!rows.length) console.log("No released or in-transit trip has a route to drive.");
  else {
    console.log("\nTrips that can be driven:\n");
    for (const r of rows) {
      console.log(`  ${r.ticket_no}  ${String(r.status).padEnd(11)} ${String(r.route_distance_km).padStart(7)} km  ${r.driver} · ${r.plate_no}`);
    }
    console.log("\n  npm run demo:drive -- --trip <TICKET-NO>\n");
  }
  await db.end();
  process.exit(0);
}

const wanted = arg("trip");
const trip = wanted
  ? rows.find((r) => r.ticket_no === wanted || String(r.id) === wanted)
  : rows[0];

if (!trip) {
  console.error(`No trackable trip matches "${wanted}". Try --list.`);
  await db.end();
  process.exit(1);
}

let geom;
try {
  geom = typeof trip.route_geometry === "string" ? JSON.parse(trip.route_geometry) : trip.route_geometry;
} catch {
  console.error("The stored route is not readable JSON.");
  await db.end();
  process.exit(1);
}
const path = (geom?.coordinates || []).map(([lng, lat]) => ({ lat, lng }));
if (path.length < 2) {
  console.error("The stored route has too few points to drive.");
  await db.end();
  process.exit(1);
}

const token = jwt.sign(
  { kind: "driver", driverId: trip.driver_id, companyId: trip.company_id },
  process.env.JWT_SECRET,
  { expiresIn: "2h" }
);

const stepKm = (SPEED_KPH / 3600) * INTERVAL_S;
const totalKm = path.reduce((sum, p, i) => (i ? sum + km(path[i - 1], p) : 0), 0);

console.log(`\n  ${trip.ticket_no} · ${trip.driver} · ${trip.plate_no}`);
console.log(`  ${path.length} route points · ${totalKm.toFixed(1)} km · ${SPEED_KPH} km/h · a ping every ${INTERVAL_S}s`);
console.log(`  roughly ${Math.round((totalKm / SPEED_KPH) * 60)} minutes of driving. Ctrl+C to stop.\n`);

let stopping = false;
process.on("SIGINT", () => { stopping = true; });

let leg = 0;            // index of the path segment being travelled
let along = 0;          // km travelled into that segment
let sent = 0, failed = 0, driven = 0;

while (!stopping) {
  let remaining = stepKm;

  while (remaining > 0 && leg < path.length - 1) {
    const legKm = km(path[leg], path[leg + 1]);
    if (along + remaining < legKm) { along += remaining; remaining = 0; }
    else { remaining -= legKm - along; leg += 1; along = 0; }
  }

  if (leg >= path.length - 1) {
    if (!LOOP) { console.log(`\n  Reached the destination after ${driven.toFixed(1)} km.`); break; }
    leg = 0; along = 0;
    console.log("  — restarting the route —");
  }

  const legKm = km(path[leg], path[leg + 1]) || 1e-9;
  const p = between(path[leg], path[leg + 1], Math.min(1, along / legKm));
  driven += stepKm;

  try {
    const res = await fetch(`${API}/api/v1/driver/trips/${trip.id}/ping`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        lat: Number(p.lat.toFixed(6)), lng: Number(p.lng.toFixed(6)),
        speedKph: SPEED_KPH, heading: p.heading, accuracyMeters: 8,
      }),
    });
    if (res.ok) {
      sent += 1;
      process.stdout.write(`\r  ${sent} pings · ${driven.toFixed(1)} / ${totalKm.toFixed(1)} km · ${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}   `);
    } else {
      failed += 1;
      const body = await res.json().catch(() => ({}));
      console.log(`\n  ping refused (${res.status}): ${body.message || "unknown"}`);
      if (res.status === 409 || res.status === 404) break;   // trip left a trackable state
    }
  } catch (e) {
    failed += 1;
    console.log(`\n  could not reach ${API}: ${e.message}`);
    break;
  }

  await sleep(INTERVAL_S * 1000);
}

console.log(`\n\n  ${sent} pings sent${failed ? `, ${failed} refused` : ""}. The trip is unchanged.\n`);
await db.end();
