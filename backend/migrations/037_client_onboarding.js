/**
 * 037 — First-login credentials for safely provisioned client administrators.
 *
 * Existing users keep their current login behaviour. Only accounts explicitly
 * provisioned with a temporary password are required to replace it.
 */
const COLUMNS = [
  ["must_change_password", "BOOLEAN NOT NULL DEFAULT FALSE"],
  ["temporary_password_expires_at", "DATETIME NULL"],
];

export async function up(conn) {
  const [existing] = await conn.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'`
  );
  const have = new Set(existing.map((row) => row.COLUMN_NAME));

  for (const [name, type] of COLUMNS) {
    if (have.has(name)) continue;
    // eslint-disable-next-line no-await-in-loop
    await conn.query(`ALTER TABLE users ADD COLUMN ${name} ${type}`);
  }
}
