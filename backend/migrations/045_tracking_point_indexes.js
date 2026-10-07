/**
 * 045 — Indexes for the GPS trail.
 *
 * trip_tracking_points only had the single-column indexes MySQL creates for its
 * foreign keys. Live Tracking's "latest point per trip", the per-trip trail and
 * the retention job's `DELETE ... WHERE recorded_at < ...` all filter on a trip
 * or company together with time, so on a large table each was a scan.
 *
 * Idempotent.
 */
async function hasIndex(conn, name) {
  const [[row]] = await conn.query(
    `SELECT COUNT(*) AS n FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trip_tracking_points' AND INDEX_NAME = ?`,
    [name]
  );
  return Number(row.n) > 0;
}

export async function up(conn) {
  if (!(await hasIndex(conn, "idx_tp_trip_time"))) {
    await conn.query("ALTER TABLE trip_tracking_points ADD INDEX idx_tp_trip_time (trip_ticket_id, recorded_at)");
  }
  if (!(await hasIndex(conn, "idx_tp_company_time"))) {
    await conn.query("ALTER TABLE trip_tracking_points ADD INDEX idx_tp_company_time (company_id, recorded_at)");
  }
}
