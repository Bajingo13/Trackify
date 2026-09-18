/**
 * 028 — Somewhere to keep the street and the barangay.
 *
 * A trip's origin and destination were each a single VARCHAR(200). The
 * geocoder now finds the house number, street and barangay behind a pin, and
 * there was nowhere to put them: everything was flattened back into one label,
 * so the system could route a truck to an exact point and still not answer
 * "which barangays did we deliver to this month".
 *
 * Flat columns rather than a joined address table. There are exactly two
 * addresses on a trip, every list and report query already reads the trip row,
 * and a join would be paid on every one of them to normalise data that is never
 * shared between trips. Filtering by barangay is the point of this migration,
 * and an indexed column on the row is what makes that cheap.
 *
 * The existing `origin` / `destination` text is left exactly as it is. It holds
 * the formatted label a person reads, and nothing depends on these columns
 * being present — a trip typed by hand, or created before today, simply has
 * them null. Nothing here rewrites history.
 *
 * Idempotent.
 */
const COLUMNS = [
  // Ordered as a Philippine address is written, and placed after the existing
  // coordinate columns so the row reads origin → where it is → what it is.
  ["origin_house_no", "VARCHAR(40) NULL AFTER origin_lng"],
  ["origin_street", "VARCHAR(160) NULL AFTER origin_house_no"],
  ["origin_barangay", "VARCHAR(120) NULL AFTER origin_street"],
  ["origin_city", "VARCHAR(120) NULL AFTER origin_barangay"],
  ["origin_province", "VARCHAR(120) NULL AFTER origin_city"],
  ["origin_postcode", "VARCHAR(20) NULL AFTER origin_province"],

  ["destination_house_no", "VARCHAR(40) NULL AFTER destination_lng"],
  ["destination_street", "VARCHAR(160) NULL AFTER destination_house_no"],
  ["destination_barangay", "VARCHAR(120) NULL AFTER destination_street"],
  ["destination_city", "VARCHAR(120) NULL AFTER destination_barangay"],
  ["destination_province", "VARCHAR(120) NULL AFTER destination_city"],
  ["destination_postcode", "VARCHAR(20) NULL AFTER destination_province"],
];

/*
 * Barangay is the level Philippine operations are actually organised around —
 * it is what a dispatcher groups a day's drops by — so both ends are indexed
 * with the company, which every scoped query already filters on.
 */
const INDEXES = [
  ["idx_tt_origin_barangay", "(company_id, origin_barangay)"],
  ["idx_tt_destination_barangay", "(company_id, destination_barangay)"],
];

export async function up(conn) {
  const [cols] = await conn.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trip_tickets'`
  );
  const have = new Set(cols.map((r) => r.COLUMN_NAME));

  for (const [name, definition] of COLUMNS) {
    if (have.has(name)) continue;
    // eslint-disable-next-line no-await-in-loop
    await conn.query(`ALTER TABLE trip_tickets ADD COLUMN ${name} ${definition}`);
  }

  const [idx] = await conn.query(
    `SELECT INDEX_NAME FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trip_tickets'`
  );
  const haveIdx = new Set(idx.map((r) => r.INDEX_NAME));

  for (const [name, definition] of INDEXES) {
    if (haveIdx.has(name)) continue;
    // eslint-disable-next-line no-await-in-loop
    await conn.query(`ALTER TABLE trip_tickets ADD INDEX ${name} ${definition}`);
  }
}
