/**
 * 053 — One driver per licence, however the number was typed.
 *
 * The duplicate check compared license_no exactly, so "N01-12-345678" and
 * "N01 12 345678" registered as two drivers, and two saves at the same moment
 * could both pass the check. license_key is the number with its separators
 * removed (shared/driverLicense.js: licenceKey / LICENSE_KEY_SQL), kept by the
 * database itself, and unique per company.
 *
 * If a database already holds two drivers with the same licence, the unique
 * key cannot be added without choosing which one is wrong, and that is not a
 * migration's decision. It then adds an ordinary index, names the duplicates
 * in the log, and the deploy carries on; the application still refuses new
 * duplicates. Once they are resolved, the unique key is added by hand:
 *   ALTER TABLE drivers DROP INDEX ix_driver_license_key,
 *     ADD UNIQUE KEY uq_driver_license_key (company_id, license_key);
 *
 * Idempotent.
 */
import { LICENSE_KEY_SQL } from "../src/shared/driverLicense.js";

const indexNamed = async (conn, name) => {
  const [rows] = await conn.query(
    `SELECT INDEX_NAME FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'drivers' AND INDEX_NAME = ?`,
    [name]
  );
  return rows.length > 0;
};

export async function up(conn) {
  const [columns] = await conn.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'drivers' AND COLUMN_NAME = 'license_key'`
  );
  if (!columns.length) {
    await conn.query(
      `ALTER TABLE drivers
         ADD COLUMN license_key VARCHAR(64) GENERATED ALWAYS AS (${LICENSE_KEY_SQL}) STORED AFTER license_no`
    );
  }

  if (await indexNamed(conn, "uq_driver_license_key")) return;

  const [dupes] = await conn.query(
    `SELECT company_id, license_key, GROUP_CONCAT(driver_id ORDER BY driver_id) AS driver_ids
       FROM drivers
      WHERE license_key IS NOT NULL AND license_key <> ''
      GROUP BY company_id, license_key
     HAVING COUNT(*) > 1`
  );
  if (dupes.length) {
    for (const d of dupes) {
      console.warn(`[migrate 053] company ${d.company_id}: drivers ${d.driver_ids} share licence ${d.license_key}`);
    }
    console.warn("[migrate 053] licence numbers are not yet unique; resolve the drivers above, then add uq_driver_license_key");
    if (!(await indexNamed(conn, "ix_driver_license_key"))) {
      await conn.query("ALTER TABLE drivers ADD INDEX ix_driver_license_key (company_id, license_key)");
    }
    return;
  }

  if (await indexNamed(conn, "ix_driver_license_key")) {
    await conn.query("ALTER TABLE drivers DROP INDEX ix_driver_license_key");
  }
  await conn.query("ALTER TABLE drivers ADD UNIQUE KEY uq_driver_license_key (company_id, license_key)");
}
