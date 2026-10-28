/**
 * 060 — Pre-trip vehicle inspections.
 *
 * Before a run starts, the driver checks the truck: brakes, tyres and lights
 * (critical) and fluids and leaks. A critical item marked as a problem stops
 * the run from starting until the Fleet team approves departure with a reason;
 * a non-critical one is flagged to them and does not stop it. The rule only
 * applies once a company turns it on (company_settings.require_pre_trip_inspection),
 * so phones still on an older app are not locked out of starting trips.
 *
 *   vehicle_inspections        one inspection, for one trip and the vehicle on
 *                              it. client_ref makes a resend from the phone's
 *                              outbox land once. departure_approved_* is the
 *                              Fleet override; reviewed_* the Fleet review.
 *   vehicle_inspection_items   one answer per checklist item, with the item's
 *                              wording as it was asked — the checklist can
 *                              change later without changing old answers.
 *   vehicle_inspection_photos  the photos of what was found wrong.
 *
 * Also: operational_exceptions.source_kind gains 'inspection', so a failed
 * inspection lands in the Exceptions panel linked back to it; and the new
 * inspection.read / inspection.review permissions are granted to the system
 * roles (provisionAllCompanies is additive and idempotent).
 *
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
    CREATE TABLE IF NOT EXISTS vehicle_inspections (
      inspection_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      company_id INT UNSIGNED NOT NULL,
      branch_id INT UNSIGNED NOT NULL,
      trip_ticket_id INT UNSIGNED NOT NULL,
      vehicle_id INT UNSIGNED NOT NULL,
      driver_id INT UNSIGNED NOT NULL,
      client_ref VARCHAR(64) NOT NULL,
      checklist_version SMALLINT UNSIGNED NOT NULL,
      -- pass; fail_noncritical (flagged, may start); fail_critical (blocked until approved)
      result ENUM('pass','fail_noncritical','fail_critical') NOT NULL,
      notes VARCHAR(1000) NULL,
      captured_lat DECIMAL(10,7) NULL,
      captured_lng DECIMAL(10,7) NULL,
      captured_at DATETIME NOT NULL,
      submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

      review_status ENUM('not_needed','pending','reviewed') NOT NULL DEFAULT 'not_needed',
      reviewed_by INT UNSIGNED NULL,
      reviewed_at DATETIME NULL,
      review_note VARCHAR(1000) NULL,

      departure_approved_by INT UNSIGNED NULL,
      departure_approved_at DATETIME NULL,
      departure_approval_reason VARCHAR(1000) NULL,

      UNIQUE KEY uq_inspection_ref (driver_id, client_ref),
      KEY idx_inspection_trip (trip_ticket_id, vehicle_id, inspection_id),
      KEY idx_inspection_review (company_id, review_status, submitted_at),
      CONSTRAINT fk_inspection_trip FOREIGN KEY (trip_ticket_id) REFERENCES trip_tickets(trip_ticket_id),
      CONSTRAINT fk_inspection_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(vehicle_id),
      CONSTRAINT fk_inspection_driver FOREIGN KEY (driver_id) REFERENCES drivers(driver_id),
      CONSTRAINT fk_inspection_company FOREIGN KEY (company_id) REFERENCES companies(company_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS vehicle_inspection_items (
      item_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      inspection_id BIGINT UNSIGNED NOT NULL,
      item_key VARCHAR(40) NOT NULL,
      label VARCHAR(120) NOT NULL,
      critical TINYINT(1) NOT NULL DEFAULT 0,
      response ENUM('ok','problem','na') NOT NULL,
      note VARCHAR(500) NULL,
      UNIQUE KEY uq_inspection_item (inspection_id, item_key),
      CONSTRAINT fk_inspection_item FOREIGN KEY (inspection_id)
        REFERENCES vehicle_inspections(inspection_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS vehicle_inspection_photos (
      photo_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      inspection_id BIGINT UNSIGNED NOT NULL,
      item_key VARCHAR(40) NULL,
      photo_path VARCHAR(500) NOT NULL,
      photo_mime VARCHAR(100) NOT NULL,
      photo_size INT UNSIGNED NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_inspection_photo (inspection_id),
      CONSTRAINT fk_inspection_photo FOREIGN KEY (inspection_id)
        REFERENCES vehicle_inspections(inspection_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  if (!(await hasColumn(conn, "company_settings", "require_pre_trip_inspection"))) {
    await conn.query(
      "ALTER TABLE company_settings ADD COLUMN require_pre_trip_inspection TINYINT(1) NOT NULL DEFAULT 0"
    );
  }

  // a failed inspection is an exception, linked back to it like pauses and requests are
  const [[col]] = await conn.query(
    `SELECT COLUMN_TYPE AS type FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'operational_exceptions' AND COLUMN_NAME = 'source_kind'`
  );
  if (col && !/'inspection'/.test(col.type)) {
    await conn.query(
      "ALTER TABLE operational_exceptions MODIFY COLUMN source_kind ENUM('pause','support','inspection') NULL"
    );
  }

  await provisionAllCompanies(conn);
}
