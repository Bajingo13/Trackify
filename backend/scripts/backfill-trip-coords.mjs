/**
 * Backfills origin/destination coordinates on trips that were saved without
 * them, by geocoding the place names already on the record.
 *
 * Why this exists: a trip with no coordinates can never be routed, so its
 * Distance and Estimated time stay blank forever. New trips no longer have
 * this problem — the trip form geocodes typed place names on save — but
 * trips created before that change still need filling in.
 *
 * Only writes rows where BOTH ends resolve. Never overwrites a coordinate
 * that is already set. Place names it cannot resolve are reported and left
 * alone. The route itself is not computed here: the existing
 * GET /operations/trips/:id/route endpoint computes and caches it on first
 * view once the coordinates are present.
 *
 *   node scripts/backfill-trip-coords.mjs           # dry run, writes nothing
 *   node scripts/backfill-trip-coords.mjs --apply   # writes
 */
import "../src/config/env.js";
import db from "../src/config/db.js";
import { geocode } from "../src/modules/operations/geo.service.js";

const APPLY = process.argv.includes("--apply");

const [rows] = await db.query(
  `SELECT trip_ticket_id, ticket_no, origin, destination
     FROM trip_tickets
    WHERE (origin_lat IS NULL OR destination_lat IS NULL)
    ORDER BY ticket_no`
);

if (rows.length === 0) {
  console.log("Every trip already has coordinates. Nothing to do.");
  process.exit(0);
}

console.log(`${rows.length} trip(s) without coordinates.${APPLY ? "" : "  (dry run — nothing will be written)"}\n`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const first = async (q) => {
  if (!q || q.trim().length < 3) return null;
  try {
    await sleep(1100); // the demo geocoder is rate limited
    const hits = await geocode(q.trim());
    return hits?.[0] || null;
  } catch {
    return null;
  }
};

let updated = 0;
let skipped = 0;

for (const t of rows) {
  const o = await first(t.origin);
  const d = await first(t.destination);

  if (!o || !d) {
    skipped += 1;
    console.log(`SKIP  ${t.ticket_no}  "${t.origin}" -> ${o ? "ok" : "unresolved"},  "${t.destination}" -> ${d ? "ok" : "unresolved"}`);
    continue;
  }

  console.log(
    `SET   ${t.ticket_no}  ${t.origin} (${o.lat.toFixed(4)}, ${o.lng.toFixed(4)})  ->  ${t.destination} (${d.lat.toFixed(4)}, ${d.lng.toFixed(4)})`
  );

  if (APPLY) {
    await db.query(
      `UPDATE trip_tickets
          SET origin_lat = COALESCE(origin_lat, ?),
              origin_lng = COALESCE(origin_lng, ?),
              destination_lat = COALESCE(destination_lat, ?),
              destination_lng = COALESCE(destination_lng, ?)
        WHERE trip_ticket_id = ?`,
      [o.lat, o.lng, d.lat, d.lng, t.trip_ticket_id]
    );
    updated += 1;
  }
}

console.log(
  `\n${APPLY ? `${updated} trip(s) updated` : `${rows.length - skipped} trip(s) would be updated`}, ${skipped} left alone.`
);
if (!APPLY) console.log("Re-run with --apply to write.");

process.exit(0);
