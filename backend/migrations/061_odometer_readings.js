/**
 * 061 — Odometer readings at the start and end of a trip.
 *
 * The driver enters what the dashboard says before Start and again before
 * "I've delivered" — with a photo of the dashboard if they choose. The two
 * give the distance actually driven, which fuel claims and service intervals
 * can be checked against. Only once a company requires it
 * (company_settings.require_odometer), so phones still on an older app are
 * not stopped from starting or delivering.
 *
 *   trip_odometer_readings  one start and one end per trip. client_ref makes a
 *                           resend from the phone's outbox land once. A wrong
 *                           reading is corrected by the Fleet team, with a
 *                           reason: corrected_* is written and the driver's
 *                           value is kept as it was entered.
 *
 * vehicles.odometer is moved forward by a reading (never back), the way a
 * completed maintenance job already moves it (fleet/maintenance.controller.js).
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
  await conn.query(`
    CREATE TABLE IF NOT EXISTS trip_odometer_readings (
      reading_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      company_id INT UNSIGNED NOT NULL,
      branch_id INT UNSIGNED NOT NULL,
      trip_ticket_id INT UNSIGNED NOT NULL,
      vehicle_id INT UNSIGNED NOT NULL,
      driver_id INT UNSIGNED NOT NULL,
      kind ENUM('start','end') NOT NULL,
      value_km DECIMAL(12,1) NOT NULL,
      client_ref VARCHAR(64) NOT NULL,
      photo_path VARCHAR(500) NULL,
      photo_mime VARCHAR(100) NULL,
      photo_size INT UNSIGNED NULL,
      captured_at DATETIME NOT NULL,
      submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

      corrected_value_km DECIMAL(12,1) NULL,
      corrected_by INT UNSIGNED NULL,
      corrected_at DATETIME NULL,
      correction_reason VARCHAR(500) NULL,

      UNIQUE KEY uq_odometer_trip_kind (trip_ticket_id, kind),
      UNIQUE KEY uq_odometer_ref (driver_id, client_ref),
      KEY idx_odometer_vehicle (vehicle_id, submitted_at),
      CONSTRAINT fk_odometer_trip FOREIGN KEY (trip_ticket_id) REFERENCES trip_tickets(trip_ticket_id),
      CONSTRAINT fk_odometer_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(vehicle_id),
      CONSTRAINT fk_odometer_driver FOREIGN KEY (driver_id) REFERENCES drivers(driver_id),
      CONSTRAINT fk_odometer_company FOREIGN KEY (company_id) REFERENCES companies(company_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  if (!(await hasColumn(conn, "company_settings", "require_odometer"))) {
    await conn.query("ALTER TABLE company_settings ADD COLUMN require_odometer TINYINT(1) NOT NULL DEFAULT 0");
  }
}
