/**
 * Backfill cached route distance / duration / geometry for every trip that has
 * both endpoint coordinates but no cached route yet.
 *
 *   npm run db:backfill-routes        (from backend/)
 *
 * Safe to rerun — only touches rows where route_geometry IS NULL. Uses the same
 * geo.service routing path as trip create/update (OSRM demo, or ORS if
 * ORS_API_KEY is set), so it is subject to the demo server's rate limits;
 * it paces itself at ~1 request/sec.
 */
import "../src/config/env.js";
import db from "../src/config/db.js";
import { route as computeRoute } from "../src/modules/operations/geo.service.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const [rows] = await db.query(
    `SELECT trip_ticket_id, ticket_no, origin, destination,
            origin_lat, origin_lng, destination_lat, destination_lng
       FROM trip_tickets
      WHERE origin_lat IS NOT NULL AND origin_lng IS NOT NULL
        AND destination_lat IS NOT NULL AND destination_lng IS NOT NULL
        AND route_geometry IS NULL`
  );

  if (!rows.length) {
    console.log("[backfill] nothing to do — every coordinated trip already has a cached route.");
    await db.end();
    return;
  }

  console.log(`[backfill] ${rows.length} trip(s) need a route.`);
  let ok = 0, fail = 0;

  for (const t of rows) {
    const r = await computeRoute(
      { lat: t.origin_lat, lng: t.origin_lng },
      { lat: t.destination_lat, lng: t.destination_lng }
    );
    if (r?.geometry) {
      await db.query(
        `UPDATE trip_tickets
            SET route_distance_km = ?, route_duration_min = ?, route_geometry = ?
          WHERE trip_ticket_id = ?`,
        [r.distanceKm, r.durationMin, JSON.stringify(r.geometry), t.trip_ticket_id]
      );
      ok++;
      console.log(`[backfill] ${t.ticket_no}  ${t.origin} -> ${t.destination}  ${r.distanceKm} km / ${r.durationMin} min`);
    } else {
      fail++;
      console.warn(`[backfill] ${t.ticket_no}  ${t.origin} -> ${t.destination}  no route (routing server returned nothing)`);
    }
    await sleep(1100);
  }

  console.log(`[backfill] done. ${ok} routed, ${fail} failed.`);
  await db.end();
}

main().catch((e) => {
  console.error(`[backfill] error: ${e.message}`);
  process.exit(1);
});
