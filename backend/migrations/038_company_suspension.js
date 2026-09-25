/**
 * 038 — Current company-suspension details.
 *
 * The audit log preserves every suspend/reactivate event. These columns hold
 * the current state so administrators can see why an inactive client is
 * blocked without reconstructing it from audit history.
 */
const COLUMNS = [
  ["suspension_reason", "VARCHAR(500) NULL"],
  ["suspended_at", "DATETIME NULL"],
  ["suspended_by", "INT UNSIGNED NULL"],
];

export async function up(conn) {
  const [existing] = await conn.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'companies'`
  );
  const have = new Set(existing.map((row) => row.COLUMN_NAME));

  for (const [name, type] of COLUMNS) {
    if (have.has(name)) continue;
    // eslint-disable-next-line no-await-in-loop
    await conn.query(`ALTER TABLE companies ADD COLUMN ${name} ${type}`);
  }
}
