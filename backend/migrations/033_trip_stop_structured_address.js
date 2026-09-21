/**
 * 033 — The same address detail on a stop as on the two ends.
 *
 * Migration 028 gave a trip's origin and destination a house number, street,
 * barangay, city, province and postcode, which is what makes "which barangays
 * did we deliver to this month" answerable. Stops were left with a single
 * VARCHAR, so a drop that happens at a waypoint — which is most of them on a
 * multi-drop run — was invisible to exactly the question the columns exist for.
 *
 * Flat columns on the row for the same reasons as 028: there are a handful of
 * stops per trip, every query that reads a stop already reads the row, and a
 * join would be paid on all of them to normalise data no two trips share.
 *
 * The existing `address` text is left exactly as it is. It holds the label a
 * person reads, nothing depends on these columns being present, and a stop
 * typed by hand or created before today simply has them null.
 *
 * Idempotent.
 */
const COLUMNS = [
  // Ordered as a Philippine address is written, after the coordinates so the
  // row reads stop → where it is → what it is.
  ["stop_house_no", "VARCHAR(40) NULL AFTER longitude"],
  ["stop_street", "VARCHAR(160) NULL AFTER stop_house_no"],
  ["stop_barangay", "VARCHAR(120) NULL AFTER stop_street"],
  ["stop_city", "VARCHAR(120) NULL AFTER stop_barangay"],
  ["stop_province", "VARCHAR(120) NULL AFTER stop_city"],
  ["stop_postcode", "VARCHAR(20) NULL AFTER stop_province"],
];

export async function up(conn) {
  const [cols] = await conn.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trip_stops'`
  );
  const have = new Set(cols.map((r) => r.COLUMN_NAME));

  for (const [name, definition] of COLUMNS) {
    if (have.has(name)) continue;
    // eslint-disable-next-line no-await-in-loop
    await conn.query(`ALTER TABLE trip_stops ADD COLUMN ${name} ${definition}`);
  }

  /*
   * Indexed on the trip as well as the barangay: every query that reaches a
   * stop comes through its trip, so the pair is what actually gets used.
   */
  const [idx] = await conn.query(
    `SELECT INDEX_NAME FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trip_stops'
        AND INDEX_NAME = 'idx_trip_stop_barangay'`
  );
  if (!idx.length) {
    await conn.query(
      `ALTER TABLE trip_stops ADD INDEX idx_trip_stop_barangay (stop_barangay, trip_ticket_id)`
    );
  }
}
