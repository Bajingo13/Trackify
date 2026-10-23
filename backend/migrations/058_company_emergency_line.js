/**
 * 058 — The company's emergency line, for the Driver App's Emergency screen.
 *
 * One number per company, set by an administrator on Settings → General and
 * shown to drivers with a Call button — kept on the phone, so it is there when
 * there is no signal, which is when it is needed most.
 *
 * Not the driver's own emergency contact (drivers.emergency_contact_*): that is
 * the driver's next of kin. This is who the driver calls.
 *
 * NULL means none has been set. No demo number is ever stored: a development
 * server shows one, labelled as demo, in its place, and production shows none
 * (see shared/companySettings.js), so a made-up number cannot reach a driver in
 * a real emergency.
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
  if (!(await hasColumn(conn, "company_settings", "emergency_line"))) {
    await conn.query(
      "ALTER TABLE company_settings ADD COLUMN emergency_line VARCHAR(20) NULL AFTER location_retention_months"
    );
  }
}
