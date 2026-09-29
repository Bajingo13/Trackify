/**
 * 040 — Account invitations.
 *
 * A new user is no longer given a password by an administrator. They are
 * emailed a single-use link, open it, confirm their name and choose their own
 * password — so nobody but them ever knows it, and no password sits in an
 * inbox.
 *
 * Until they accept, the account's status is 'invited': it cannot sign in, and
 * every list that asks for active users already leaves it out.
 *
 * The token is stored HASHED, like password_reset_tokens (036): the plain
 * token exists in one email and nowhere else. revoked_at marks a link that a
 * resend replaced, so an older email stops working the moment a newer one is
 * sent.
 *
 * Idempotent.
 */
export async function up(conn) {
  const [[column]] = await conn.query(
    `SELECT COLUMN_TYPE AS type FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'status'`
  );
  if (column && !String(column.type).includes("'invited'")) {
    await conn.query(
      "ALTER TABLE users MODIFY COLUMN status ENUM('active','inactive','invited') NOT NULL DEFAULT 'active'"
    );
  }

  await conn.query(`
    CREATE TABLE IF NOT EXISTS user_invitations (
      invitation_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id INT UNSIGNED NOT NULL,

      -- sha256 of the token that was emailed, hex
      token_hash CHAR(64) NOT NULL,

      expires_at DATETIME NOT NULL,
      used_at DATETIME NULL,
      revoked_at DATETIME NULL,

      -- who sent it; kept if that administrator is later removed
      invited_by INT UNSIGNED NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

      UNIQUE KEY uq_user_invitation_token (token_hash),
      KEY ix_user_invitation_user (user_id, used_at, revoked_at),

      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
      FOREIGN KEY (invited_by) REFERENCES users(user_id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}
