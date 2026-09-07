/**
 * 022 — Record arrival at a stop.
 *
 * trip_stops carried a planned_arrival and nothing else: a stop shaped the
 * route and dropped a pin, but nothing ever marked one as reached. A skipped
 * stop left no trace, and dispatch could not tell whether a three-drop run was
 * on its first drop or its last.
 *
 * Mirrors the proof-of-delivery shape: when it happened, where the driver
 * actually was, who recorded it, and an optional note.
 *
 * Idempotent.
 */
export async function up(conn) {
  const [cols] = await conn.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trip_stops'
        AND COLUMN_NAME = 'actual_arrival'`
  );
  if (cols.length) return;

  await conn.query(`
    ALTER TABLE trip_stops
      ADD COLUMN actual_arrival DATETIME NULL AFTER planned_arrival,
      ADD COLUMN arrived_lat DECIMAL(10,7) NULL AFTER actual_arrival,
      ADD COLUMN arrived_lng DECIMAL(10,7) NULL AFTER arrived_lat,
      ADD COLUMN arrived_by_driver_id INT UNSIGNED NULL AFTER arrived_lng,
      ADD COLUMN arrival_note VARCHAR(255) NULL AFTER arrived_by_driver_id
  `);

  await conn.query(
    `ALTER TABLE trip_stops ADD INDEX idx_trip_stops_arrival (trip_ticket_id, actual_arrival)`
  );
}
