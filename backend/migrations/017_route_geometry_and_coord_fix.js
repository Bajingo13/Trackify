/**
 * 017 — Stored route geometry + corrected demo trip coordinates.
 *
 * Two fixes for the Live Tracking map:
 *
 *  1. Add `trip_tickets.route_geometry` (JSON). The planned road path is now
 *     cached on the trip instead of being re-fetched from OSRM on every map
 *     render — so the line survives a slow/failed routing call and the drawn
 *     route always matches the stored distance/ETA.
 *
 *  2. Migration 015's demo seed guessed coordinates from a 5-city list and
 *     fell back to an arbitrary neighbour when the real destination wasn't in
 *     it — e.g. a "Davao City -> Zamboanga City" trip got General Santos
 *     coordinates, so the route line shot off into the Celebes Sea. This
 *     re-derives origin/destination coordinates for company-1 demo trips from
 *     a real PH gazetteer, and NULLs them for destinations with no road route
 *     from Davao (Cebu, Manila, ...). Any row whose coordinates change also has
 *     its cached route_distance_km / route_duration_min / route_geometry
 *     cleared so `scripts/backfillRoutes.js` recomputes them.
 *
 * Idempotent.
 */

async function addColumn(conn, table, column, ddl) {
  const [cols] = await conn.query(`SHOW COLUMNS FROM ${table} LIKE ?`, [column]);
  if (!cols.length) await conn.query(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

// Real coordinates for the places the demo trips actually name. Longest key
// wins on match, so "General Santos" beats "Santos" etc.
const GAZETTEER = [
  ["davao city", { lat: 7.0731, lng: 125.6128 }],
  ["tagum city", { lat: 7.4478, lng: 125.8078 }],
  ["panabo city central", { lat: 7.3081, lng: 125.6841 }],
  ["panabo city", { lat: 7.3081, lng: 125.6841 }],
  ["digos city", { lat: 6.7496, lng: 125.3572 }],
  ["general santos", { lat: 6.1164, lng: 125.1716 }],
  ["gensan", { lat: 6.1164, lng: 125.1716 }],
  ["mati city", { lat: 6.9489, lng: 126.2272 }],
  ["cotabato city", { lat: 7.2047, lng: 124.231 }],
  ["cotabato", { lat: 7.2047, lng: 124.231 }],
  ["surigao city", { lat: 9.7894, lng: 125.4947 }],
  ["butuan city", { lat: 8.9475, lng: 125.5406 }],
  ["cagayan de oro", { lat: 8.4542, lng: 124.6319 }],
  ["valencia city", { lat: 7.906, lng: 125.0947 }],
  ["bukidnon", { lat: 8.1575, lng: 125.1278 }],
  ["zamboanga city", { lat: 6.9214, lng: 122.079 }],
];

// Destinations that share no road network with Davao — no route possible.
const OFF_ISLAND = ["cebu", "manila", "makati", "balayan", "luzon", "iloilo", "bacolod"];

function lookup(name) {
  const n = String(name || "").trim().toLowerCase();
  if (!n) return null;
  if (OFF_ISLAND.some((x) => n.includes(x))) return "OFF_ISLAND";
  for (const [key, coord] of GAZETTEER) {
    if (n.includes(key)) return coord;
  }
  return null;
}

export async function up(conn) {
  await addColumn(conn, "trip_tickets", "route_geometry", "route_geometry JSON NULL AFTER route_duration_min");

  const [trips] = await conn.query(
    `SELECT trip_ticket_id, origin, destination, origin_lat, origin_lng,
            destination_lat, destination_lng
       FROM trip_tickets WHERE company_id = 1`
  );

  for (const t of trips) {
    const o = lookup(t.origin);
    const d = lookup(t.destination);

    let oLat = null, oLng = null, dLat = null, dLng = null;
    if (o && o !== "OFF_ISLAND" && d && d !== "OFF_ISLAND") {
      oLat = o.lat; oLng = o.lng; dLat = d.lat; dLng = d.lng;
    }
    // else: leave all four NULL (unknown place or off-island destination)

    const same =
      Number(t.origin_lat) === oLat && Number(t.origin_lng) === oLng &&
      Number(t.destination_lat) === dLat && Number(t.destination_lng) === dLng;
    if (same) continue;

    await conn.query(
      `UPDATE trip_tickets
          SET origin_lat = ?, origin_lng = ?, destination_lat = ?, destination_lng = ?,
              route_distance_km = NULL, route_duration_min = NULL, route_geometry = NULL
        WHERE trip_ticket_id = ?`,
      [oLat, oLng, dLat, dLng, t.trip_ticket_id]
    );
  }
}
