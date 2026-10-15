/**
 * 052 — Driver licence expiry reminder delivery history.
 *
 * Licence data remains owned exclusively by authorized office users. The
 * Driver App is read-only and therefore needs no submission or review columns.
 * This table only remembers which expiry notices have already been delivered,
 * so scheduled monitoring is idempotent across restarts and server instances.
 */
export async function up(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS driver_license_reminders (
      reminder_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      driver_id INT UNSIGNED NOT NULL,
      expires_on DATE NOT NULL,
      -- days before the expiry date; 0 is the "has expired" notice
      threshold_days SMALLINT UNSIGNED NOT NULL,
      -- who the notice was for: the driver's phone, or the office
      audience ENUM('driver','office') NOT NULL,
      -- how many people / devices it reached
      recipients INT UNSIGNED NOT NULL DEFAULT 0,
      sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

      UNIQUE KEY uq_driver_license_reminder (driver_id, expires_on, threshold_days, audience),
      FOREIGN KEY (driver_id) REFERENCES drivers(driver_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}
