import { issueLicense, DEFAULT_TERM_MONTHS } from "../src/shared/license.js";

/**
 * 043 — Client licenses.
 *
 * One license per client per system (UNIQUE company_id + system_code), with a
 * globally unique, system-generated number. expires_at NULL means perpetual.
 *
 * Every company that already exists is issued a license here, valid for a year
 * from this migration, so turning enforcement on later cannot lock out a
 * client that was simply set up before licensing existed.
 *
 * Idempotent: the table is created if missing and only companies without a
 * license are backfilled.
 */
export async function up(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS licenses (
      license_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      company_id INT UNSIGNED NOT NULL,
      system_code VARCHAR(20) NOT NULL,
      license_number VARCHAR(100) NOT NULL,
      status ENUM('active','revoked') NOT NULL DEFAULT 'active',

      issued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NULL,

      revoked_at DATETIME NULL,
      revoked_reason VARCHAR(500) NULL,
      revoked_by INT UNSIGNED NULL,
      issued_by INT UNSIGNED NULL,

      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

      UNIQUE KEY uq_license_number (license_number),
      UNIQUE KEY uq_license_company_system (company_id, system_code),
      KEY ix_license_expiry (status, expires_at),

      FOREIGN KEY (company_id) REFERENCES companies(company_id) ON DELETE CASCADE,
      FOREIGN KEY (revoked_by) REFERENCES users(user_id) ON DELETE SET NULL,
      FOREIGN KEY (issued_by) REFERENCES users(user_id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const [companies] = await conn.query(
    `SELECT c.company_id, c.company_code
       FROM companies c
       LEFT JOIN licenses l ON l.company_id = c.company_id
      WHERE l.license_id IS NULL`
  );
  for (const company of companies) {
    // eslint-disable-next-line no-await-in-loop
    await issueLicense(conn, {
      companyId: company.company_id,
      companyCode: company.company_code,
      termMonths: DEFAULT_TERM_MONTHS,
    });
  }
}
