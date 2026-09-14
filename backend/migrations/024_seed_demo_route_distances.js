/**
 * 024 — Seed the demo trips with their real road distances.
 *
 * Migration 017 nulls route_distance_km / route_duration_min for trips whose
 * coordinates it corrected, and the values are normally put back by
 * `db:backfill-routes`, which asks OSRM over the network one trip a second.
 * That is fine on a workstation and useless in CI: a freshly migrated database
 * has no routes, so odometer.e2e.mjs finds no trip with a planned distance and
 * exits 2 — which is why the end-to-end job could never gate a merge.
 *
 * These are the real figures the backfill produced, recorded here so a fresh
 * database has them without a network call. They are not estimates and not
 * recomputed straight-line guesses; a straight line between two points is a
 * road that does not exist.
 *
 * Only fills gaps. A trip that already carries a distance keeps it, so running
 * the backfill afterwards still wins and this never clobbers recomputed data.
 */

const ROUTES = [
  ["DVO-2026-0001", 53.44, 63],
  ["DVO-2026-0002", 192.18, 180],
  ["DVO-2026-0003", 142.67, 133],
  ["DVO-2026-0004", 767.76, 1440],
  ["DVO-2026-0005", 1489.15, 1439],
  ["DVO-2026-0006", 53.44, 63],
  ["DVO-2026-0007", 232.45, 203],
  ["DVO-2026-0008", 767.76, 1440],
  ["DVO-2026-0009", 53.44, 63],
  ["DVO-2026-0010", 192.27, 180],
  ["DVO-2026-0011", 30.95, 43],
  ["DVO-2026-0012", 56.7, 61],
  ["DVO-2026-0013", 53.44, 63],
  ["DVO-2026-0014", 619.34, 655],
  ["DVO-2026-0015", 161.59, 158],
  ["DVO-2026-0016", 283.94, 254],
  ["DVO-2026-0017", 289.21, 279],
  ["DVO-2026-0018", 142.67, 133],
  ["DVO-2026-0019", 646.09, 687],
  ["DVO-2026-0020", 53.44, 63],
  ["DVO-2026-0021", 156.43, 169],
  ["DVO-2026-0022", 56.7, 61],
  ["DVO-2026-0023", 232.45, 203],
  ["DVO-2026-0024", 389.05, 379],
  ["DVO-2026-0025", 53.44, 63],
  ["TT-2026-000031", 30.95, 43],
  ["TT-2026-000045", 106.63, 102],
  ["TT-2026-000139", 108.26, 109],
];

export async function up(conn) {
  for (const [ticketNo, km, mins] of ROUTES) {
    await conn.execute(
      `UPDATE trip_tickets
          SET route_distance_km = ?, route_duration_min = ?
        WHERE ticket_no = ?
          AND route_distance_km IS NULL`,
      [km, mins, ticketNo]
    );
  }
}
