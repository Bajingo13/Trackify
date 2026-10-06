/**
 * 042 — Invitation identity check.
 *
 * Opening an invitation link now asks the person to type the email address the
 * invitation was sent to. failed_attempts counts the wrong answers; at the limit
 * locked_at is set and that link is dead for good. Only a fresh invitation
 * (which revokes this one) starts a new count.
 *
 * Idempotent.
 */
async function hasColumn(conn, column) {
  const [[row]] = await conn.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_invitations' AND COLUMN_NAME = ?`,
    [column]
  );
  return Number(row.n) > 0;
}

export async function up(conn) {
  if (!(await hasColumn(conn, "failed_attempts"))) {
    await conn.query("ALTER TABLE user_invitations ADD COLUMN failed_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0");
  }
  if (!(await hasColumn(conn, "locked_at"))) {
    await conn.query("ALTER TABLE user_invitations ADD COLUMN locked_at DATETIME NULL");
  }
}
