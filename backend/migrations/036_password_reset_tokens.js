/**
 * 036 — Password reset links.
 *
 * Until now a locked-out user had to find an administrator, because the system
 * could not send email at all. With a mailer there is a reset flow, and this
 * is the one table it needs.
 *
 * The token is stored HASHED, exactly like a password. A reset token is a
 * working key to an account for as long as it lives, so a database dump, a
 * backup file, or a read through some unrelated injection must not hand over
 * usable links. The plain token exists in one email and nowhere else; the
 * server hashes what arrives and looks for the match.
 *
 * used_at rather than deleting the row: a link that has already been used and
 * a link that was never issued should not be distinguishable to somebody
 * probing, and the used row is also the evidence that the reset happened.
 *
 * Idempotent.
 */
export async function up(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      token_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id INT UNSIGNED NOT NULL,

      -- sha256 of the token that was emailed, hex
      token_hash CHAR(64) NOT NULL,

      expires_at DATETIME NOT NULL,
      used_at DATETIME NULL,

      -- where the request came from, for the audit trail after an incident
      requested_ip VARCHAR(64) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

      UNIQUE KEY uq_password_reset_token (token_hash),
      KEY ix_password_reset_user (user_id, used_at),

      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}
