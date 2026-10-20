/**
 * 057 — A new phone is verified by a code sent to the driver's email.
 *
 * 056 gave drivers paper recovery codes, because drivers had no email on file.
 * Writing codes down and keeping them proved a burden, so a driver now has an
 * email address, and whenever a phone needs verifying — the first sign-in on a
 * new account, or a move to another phone — the system emails a one-time code.
 *
 * drivers.email is where the code is sent. Required for new drivers (the
 * registration form and createDriver enforce it); a driver from before this has
 * none until the office adds it, and until then a new phone is approved by the
 * office.
 *
 * driver_device_email_codes are those codes, kept as sha256 bound to the phone
 * they were sent for. Each works once and for a few minutes; sending a new one
 * cancels the last. `attempts` caps guesses at one code, on top of the
 * driver-wide lock from 056.
 *
 * driver_devices.office_requested_at marks a waiting phone whose driver asked
 * the office to approve it (no access to their email, or locked out). Only
 * those are put in front of the office: a driver who is simply opening their
 * email should not set off every console's bell.
 *
 * approved_via gains 'email_code'. driver_recovery_codes is no longer written
 * or read; it is left in place, as nothing depends on dropping it.
 *
 * Additive and idempotent.
 */

const hasColumn = async (conn, table, column) => {
  const [rows] = await conn.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows.length > 0;
};

export async function up(conn) {
  if (!(await hasColumn(conn, "drivers", "email"))) {
    await conn.query("ALTER TABLE drivers ADD COLUMN email VARCHAR(200) NULL AFTER phone");
  }

  await conn.query(`
    CREATE TABLE IF NOT EXISTS driver_device_email_codes (
      code_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      company_id INT UNSIGNED NOT NULL,
      driver_id INT UNSIGNED NOT NULL,
      device_id BIGINT UNSIGNED NOT NULL,
      -- sha256 of "<device_id>:<code>", hex
      code_hash CHAR(64) NOT NULL,
      sent_to VARCHAR(200) NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      expires_at DATETIME(3) NOT NULL,
      attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
      used_at DATETIME(3) NULL,
      -- a newer code replaced this one, or too many wrong tries
      revoked_at DATETIME(3) NULL,
      KEY ix_email_code_device (device_id, created_at),
      KEY ix_email_code_driver (driver_id, created_at),
      FOREIGN KEY (driver_id) REFERENCES drivers(driver_id) ON DELETE CASCADE,
      FOREIGN KEY (device_id) REFERENCES driver_devices(device_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  if (!(await hasColumn(conn, "driver_devices", "office_requested_at"))) {
    await conn.query("ALTER TABLE driver_devices ADD COLUMN office_requested_at DATETIME(3) NULL AFTER last_ip");
  }

  await conn.query(`
    ALTER TABLE driver_devices
      MODIFY COLUMN approved_via ENUM('first_device','recovery_code','office','email_code') NULL
  `);
}
