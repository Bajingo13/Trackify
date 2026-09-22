/**
 * 035 — A photograph on a staff account.
 *
 * My Profile showed a camera button that toasted "Photo upload isn't available
 * yet", and the page said the same about the name and email underneath it. A
 * driver has had a photograph on their record since migration 025; the people
 * in the office had a coloured circle with an initial in it.
 *
 * Same shape as the driver's, and for the same reasons: the bytes stay on disk
 * under the shared upload root so the directory can move between environments
 * without a data migration, and photo_updated_at exists so the browser can
 * cache-bust its own avatar — without it somebody changes their photo, the URL
 * does not change, the old one keeps showing, and that reads as a failed
 * upload.
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
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'`
  );
  const have = new Set(existing.map((r) => r.COLUMN_NAME));

  for (const [name, type] of COLUMNS) {
    if (have.has(name)) continue;
    // eslint-disable-next-line no-await-in-loop
    await conn.query(`ALTER TABLE users ADD COLUMN ${name} ${type}`);
  }
}
