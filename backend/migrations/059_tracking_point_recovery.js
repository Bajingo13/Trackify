/**
 * 059 — GPS points recovered after a dead zone.
 *
 * Out of signal the Driver App keeps a sparse trail of where the truck was and
 * uploads it once it is back in coverage (POST /driver/trips/:id/trail). Three
 * columns make that safe:
 *
 *   client_ref   the phone's own name for one GPS reading. With the unique key
 *                below, the same reading sent twice — a retried batch, or a
 *                live ping and the recovered copy of it — is stored once.
 *   received_at  when the server got it. recorded_at stays the time the phone
 *                captured it, so the trail, the retention sweep and "latest
 *                position" keep reading recorded_at exactly as before.
 *   source       'live' as sent, or 'recovered' from the phone's backlog, so
 *                the office can tell a point reported late from one in time.
 *
 * Rows from before this have no client_ref (NULL never collides in a unique
 * key) and read as 'live'. Additive and idempotent.
 */

const hasColumn = async (conn, table, column) => {
  const [rows] = await conn.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows.length > 0;
};

const hasIndex = async (conn, table, index) => {
  const [rows] = await conn.query(
    `SELECT INDEX_NAME FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, index]
  );
  return rows.length > 0;
};

export async function up(conn) {
  if (!(await hasColumn(conn, "trip_tracking_points", "client_ref"))) {
    await conn.query("ALTER TABLE trip_tracking_points ADD COLUMN client_ref VARCHAR(64) NULL AFTER gps_status");
  }
  if (!(await hasColumn(conn, "trip_tracking_points", "received_at"))) {
    await conn.query("ALTER TABLE trip_tracking_points ADD COLUMN received_at DATETIME NULL AFTER recorded_at");
  }
  if (!(await hasColumn(conn, "trip_tracking_points", "source"))) {
    await conn.query(
      "ALTER TABLE trip_tracking_points ADD COLUMN source ENUM('live','recovered') NOT NULL DEFAULT 'live' AFTER received_at"
    );
  }
  if (!(await hasIndex(conn, "trip_tracking_points", "uq_tp_driver_ref"))) {
    await conn.query("ALTER TABLE trip_tracking_points ADD UNIQUE KEY uq_tp_driver_ref (driver_id, client_ref)");
  }
}
