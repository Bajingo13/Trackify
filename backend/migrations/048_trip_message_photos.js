/**
 * 048 — A photo on a chat message.
 *
 * A driver at a gate has things to show dispatch that words do not carry: the
 * signed delivery receipt, the fuel slip, the dent in the bumper. The photo is
 * part of the message and stays in the thread, so the same history that records
 * what was said records what was shown.
 *
 * Same shape as every other driver-captured file: the bytes live on disk under
 * the shared upload root and the row keeps only the relative path, so the
 * directory can move between environments without a data migration. A photo
 * message may have no words, so body stays NOT NULL and is stored as ''.
 *
 * Idempotent.
 */
const COLUMNS = [
  ["photo_path", "VARCHAR(255) NULL"],
  ["photo_mime", "VARCHAR(100) NULL"],
  ["photo_size", "INT UNSIGNED NULL"],
];

export async function up(conn) {
  const [existing] = await conn.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trip_messages'`
  );
  const have = new Set(existing.map((r) => r.COLUMN_NAME));

  for (const [name, type] of COLUMNS) {
    if (have.has(name)) continue;
    // eslint-disable-next-line no-await-in-loop
    await conn.query(`ALTER TABLE trip_messages ADD COLUMN ${name} ${type}`);
  }
}
