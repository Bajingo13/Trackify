/**
 * 046 — An index for finding and listing a branch's trips newest-first.
 *
 * trip_tickets had indexes for ticket number and barangay but none that served
 * `WHERE company_id = ? AND branch_id = ? ORDER BY created_at DESC`, which is
 * what both the Trips list and the Ctrl+K search ask. Without it MySQL read the
 * whole company, filtered by branch, and sorted the lot in memory for every
 * request. Measured on 300,000 trips this took a search from about a second to
 * about a millisecond when the term is common, and the no-match worst case from
 * about a second to about 0.3 s.
 *
 * Safe on a live table:
 *   • ALGORITHM=INPLACE, LOCK=NONE: the index is built while reads and writes
 *     carry on. Named explicitly so that if the server could not do it online
 *     the statement fails, instead of quietly taking a table lock.
 *   • lock_wait_timeout: the only moments it needs the table to itself are the
 *     start and the end, and if a long transaction is holding the table at
 *     either, waiting forever makes every later query queue behind this
 *     statement. Waiting a bounded time and failing is the lesser harm — the
 *     migration is retried on the next start, and nothing is half-applied.
 *
 * Idempotent.
 */
const LOCK_WAIT_SECONDS = 30;

async function hasIndex(conn, name) {
  const [[row]] = await conn.query(
    `SELECT COUNT(*) AS n FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trip_tickets' AND INDEX_NAME = ?`,
    [name]
  );
  return Number(row.n) > 0;
}

export async function up(conn) {
  if (await hasIndex(conn, "idx_tt_scope_created")) return;

  await conn.query(`SET SESSION lock_wait_timeout = ${LOCK_WAIT_SECONDS}`);
  try {
    await conn.query(
      `ALTER TABLE trip_tickets
         ADD INDEX idx_tt_scope_created (company_id, branch_id, created_at),
         ALGORITHM=INPLACE, LOCK=NONE`
    );
  } catch (error) {
    if (error.code === "ER_LOCK_WAIT_TIMEOUT") {
      throw new Error(
        `046: trip_tickets was held by another transaction for ${LOCK_WAIT_SECONDS}s, so the index was not added. ` +
          "Nothing was changed; it will be retried on the next start."
      );
    }
    throw error;
  }
}
