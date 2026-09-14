/**
 * 025 — A photograph on the driver's own record.
 *
 * The driver app had no notion of the person using it beyond a name and an
 * employee number. A driver opening it saw a list of somebody's trips; there
 * was nothing that said "this is your account", and nothing they could change.
 *
 * Bytes stay on disk under the same upload root as receipts and PODs — only
 * the relative path is stored here, so the directory can move between
 * environments without a data migration.
 *
 * photo_updated_at exists so the app can cache-bust its own avatar. Without
 * it a driver changes their photo, the URL does not change, and the phone
 * keeps showing the old one — which reads as "the upload failed".
 *
 * Idempotent.
 */
const COLUMNS = [
  ["photo_path", "VARCHAR(255) NULL"],
  ["photo_mime", "VARCHAR(100) NULL"],
  ["photo_size", "INT UNSIGNED NULL"],
  ["photo_updated_at", "DATETIME NULL"],
];

export async function up(conn) {
  const [existing] = await conn.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'drivers'`
  );
  const have = new Set(existing.map((r) => r.COLUMN_NAME));

  for (const [name, type] of COLUMNS) {
    if (have.has(name)) continue;
    // eslint-disable-next-line no-await-in-loop
    await conn.query(`ALTER TABLE drivers ADD COLUMN ${name} ${type}`);
  }
}
