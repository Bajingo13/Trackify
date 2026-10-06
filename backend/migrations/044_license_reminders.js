/**
 * 044 — Record of license-expiry reminders.
 *
 * One row per (license, end date, threshold) — "the 7-day warning for the
 * license that ends on 2027-03-01". The unique key is what stops a client from
 * being emailed the same warning twice, even with two server instances or a
 * restart in the middle of a sweep.
 *
 * expires_at is part of the key on purpose: renewing a license moves its end
 * date, so the next cycle of warnings starts fresh instead of being treated as
 * already sent.
 *
 * Idempotent.
 */
export async function up(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS license_reminders (
      reminder_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      license_id INT UNSIGNED NOT NULL,
      expires_at DATETIME NOT NULL,
      -- days before the end date; 0 is the "has expired" notice
      threshold_days SMALLINT UNSIGNED NOT NULL,
      recipients INT UNSIGNED NOT NULL DEFAULT 0,
      sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

      UNIQUE KEY uq_license_reminder (license_id, expires_at, threshold_days),
      FOREIGN KEY (license_id) REFERENCES licenses(license_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}
