/**
 * 056 — One trusted phone per driver.
 *
 * Until now a driver's employee number and PIN opened the account on any phone,
 * and nothing recorded which one. A PIN is four digits a colleague can watch
 * being typed; on its own it was the whole of the account.
 *
 * driver_devices is the phones a driver has signed in on. Each phone makes a
 * random key the first time the app opens and sends it with every request; only
 * its sha256 is kept here, so this table cannot be used to impersonate a phone.
 * A driver has at most one `active` phone. A sign-in from any other phone is
 * `pending` and sees nothing until the driver proves it is them with a recovery
 * code, or the office approves it. The phone it replaces becomes `revoked`.
 * A phone the office signs out — lost, stolen, or one it refused — is
 * `blocked`: the PIN alone can never bring it back.
 *
 * driver_recovery_codes are the single-use codes a driver writes down when their
 * first phone is set up — the way back in when that phone breaks on the road,
 * without needing the office. Stored as sha256: the plain codes exist on the
 * driver's paper and nowhere else.
 *
 * device_verify_failures / device_verify_locked_at stop someone working through
 * codes: after too many wrong ones, only the office can unlock the driver.
 *
 * device_enroll_open says the next phone to give the PIN may simply become the
 * trusted one. It is open for a driver who has never set a phone up and after
 * an office reset, and closes the moment a phone is set up. Having no trusted
 * phone is not enough — after the office signs a phone out, the PIN alone must
 * not hand the account to whoever tries next.
 *
 * driver_push_subscriptions.device_id ties a notification address to the phone
 * that registered it, so a revoked phone stops being sent notices.
 *
 * Also grants driver.device.manage to the roles that look after drivers.
 * Additive and idempotent.
 */
import { provisionAllCompanies } from "../src/shared/provisionRoles.js";

const hasColumn = async (conn, table, column) => {
  const [rows] = await conn.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows.length > 0;
};

export async function up(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS driver_devices (
      device_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      company_id INT UNSIGNED NOT NULL,
      driver_id INT UNSIGNED NOT NULL,
      -- sha256 of the key the phone made for itself, hex
      key_hash CHAR(64) NOT NULL,
      user_agent VARCHAR(255) NULL,
      -- revoked: replaced by another phone, may ask again. blocked: signed out by
      -- the office (lost, stolen, refused) and may not sign in again until a reset.
      status ENUM('pending','active','revoked','blocked') NOT NULL DEFAULT 'pending',
      approved_via ENUM('first_device','recovery_code','office') NULL,
      approved_by_user_id INT UNSIGNED NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      approved_at DATETIME(3) NULL,
      last_seen_at DATETIME(3) NULL,
      last_ip VARCHAR(64) NULL,
      revoked_at DATETIME(3) NULL,
      revoked_reason VARCHAR(120) NULL,
      UNIQUE KEY uq_device_driver_key (driver_id, key_hash),
      KEY ix_device_driver (company_id, driver_id, status),
      FOREIGN KEY (driver_id) REFERENCES drivers(driver_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS driver_recovery_codes (
      code_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      company_id INT UNSIGNED NOT NULL,
      driver_id INT UNSIGNED NOT NULL,
      -- sha256 of the code as written down, normalised (upper case, no dashes), hex
      code_hash CHAR(64) NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      used_at DATETIME(3) NULL,
      used_device_id BIGINT UNSIGNED NULL,
      -- a newer set replaced this one
      revoked_at DATETIME(3) NULL,
      KEY ix_recovery_driver (driver_id, used_at, revoked_at),
      FOREIGN KEY (driver_id) REFERENCES drivers(driver_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  if (!(await hasColumn(conn, "drivers", "device_verify_failures"))) {
    await conn.query(`
      ALTER TABLE drivers
        ADD COLUMN device_verify_failures SMALLINT UNSIGNED NOT NULL DEFAULT 0,
        ADD COLUMN device_verify_locked_at DATETIME(3) NULL,
        ADD COLUMN device_enroll_open TINYINT(1) NOT NULL DEFAULT 1
    `);
  }

  if (!(await hasColumn(conn, "driver_push_subscriptions", "device_id"))) {
    await conn.query(`
      ALTER TABLE driver_push_subscriptions
        ADD COLUMN device_id BIGINT UNSIGNED NULL AFTER driver_id,
        ADD KEY ix_push_device (device_id)
    `);
  }

  await provisionAllCompanies(conn);
}
