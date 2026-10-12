/**
 * 047 — Indexes so the Trips list can be filtered and counted by the database.
 *
 * The Trips screens used to download trips and count/filter them in the browser,
 * which stopped being correct at the server's 100-row page. Doing it in the
 * database is only a gain if the database can answer without reading every trip
 * in the branch. Measured on 300,000 trips (100,000 in the branch):
 *
 *   count per status (stat cards, approval queue, dashboard)   1,925 ms ->  ~40-130 ms
 *   count with a status filter (the list's "1-20 of N")        1,627 ms ->   ~5 ms
 *   count with a priority filter                               1,714 ms ->   ~10 ms
 *   distinct barangays for the filter dropdown                 4,100 ms ->  ~190 ms
 *
 * Each index leads with (company_id, branch_id), the scope every query is
 * already restricted to, and then the column being filtered, so the answer comes
 * from the index alone ("covering") instead of from the table rows:
 *
 *   idx_tt_scope_status       status   — per-status counts and the status filter
 *   idx_tt_scope_priority     priority — the priority filter and its count
 *   idx_tt_scope_origin_brgy  origin_barangay      — the barangay options
 *   idx_tt_scope_dest_brgy    destination_barangay — the barangay options
 *
 * Built the same careful way as 046, all four in one online statement
 * (ALGORITHM=INPLACE, LOCK=NONE: reads and writes carry on, and the statement
 * fails rather than silently taking a lock if that were not possible; about 7 s
 * for 300,000 trips), with a bounded lock wait so a long transaction cannot make
 * every other query queue behind it.
 *
 * Idempotent: only the indexes that are missing are added.
 */
const LOCK_WAIT_SECONDS = 30;

const WANTED = [
  ["idx_tt_scope_status", "(company_id, branch_id, status)"],
  ["idx_tt_scope_priority", "(company_id, branch_id, priority)"],
  ["idx_tt_scope_origin_brgy", "(company_id, branch_id, origin_barangay)"],
  ["idx_tt_scope_dest_brgy", "(company_id, branch_id, destination_barangay)"],
];

async function existingIndexes(conn) {
  const [rows] = await conn.query(
    `SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trip_tickets'`
  );
  return new Set(rows.map((r) => r.INDEX_NAME));
}

export async function up(conn) {
  const have = await existingIndexes(conn);
  const missing = WANTED.filter(([name]) => !have.has(name));
  if (!missing.length) return;

  await conn.query(`SET SESSION lock_wait_timeout = ${LOCK_WAIT_SECONDS}`);
  try {
    await conn.query(
      `ALTER TABLE trip_tickets
         ${missing.map(([name, cols]) => `ADD INDEX ${name} ${cols}`).join(",\n         ")},
         ALGORITHM=INPLACE, LOCK=NONE`
    );
  } catch (error) {
    if (error.code === "ER_LOCK_WAIT_TIMEOUT") {
      throw new Error(
        `047: trip_tickets was held by another transaction for ${LOCK_WAIT_SECONDS}s, so the indexes were not added. ` +
          "Nothing was changed; it will be retried on the next start."
      );
    }
    throw error;
  }
}
