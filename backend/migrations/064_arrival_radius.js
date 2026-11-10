/**
 * 064 — Company-configurable delivery arrival radius.
 *
 * Existing companies keep the historical 150 metre behaviour. The value is
 * deliberately bounded again in application code; the database default makes
 * old rows and newly-created companies safe before anyone opens Settings.
 *
 * Additive and idempotent.
 */

export async function up(conn) {
  const [rows] = await conn.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'company_settings'
        AND COLUMN_NAME = 'arrival_radius_m'`
  );
  if (!rows.length) {
    await conn.query(
      "ALTER TABLE company_settings ADD COLUMN arrival_radius_m SMALLINT UNSIGNED NOT NULL DEFAULT 150"
    );
  }
}
