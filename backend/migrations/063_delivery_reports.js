/**
 * 063 — Delivery exceptions: what went wrong at the drop-off.
 *
 * A driver at the drop-off who cannot deliver as planned says so, with a
 * reason, words and photos, instead of burying it in the POD note or asking
 * for a pause:
 *
 *   delivered_with_issue   the load was handed over, but short, damaged or
 *                          the wrong item. Filed after the POD, which stands.
 *   not_delivered          the load was not handed over: refused, nobody
 *                          there, wrong address, something else. No POD; the
 *                          trip stays on the road until the office decides.
 *
 *   delivery_reports        one report. client_ref makes a resend from the
 *                           phone's outbox land once. status follows the
 *                           office's decision: open → reattempt / returned /
 *                           resolved (or resolved by a later delivery).
 *   delivery_report_photos  the photos of it.
 *
 * Each report is also an exception (operational_exceptions.source_kind gains
 * 'delivery_report'), raised as the alert types the system already lists:
 * cargo_shortage, cargo_damage, failed_delivery.
 *
 * Additive and idempotent.
 */

export async function up(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS delivery_reports (
      report_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      company_id INT UNSIGNED NOT NULL,
      branch_id INT UNSIGNED NOT NULL,
      trip_ticket_id INT UNSIGNED NOT NULL,
      driver_id INT UNSIGNED NOT NULL,
      client_ref VARCHAR(64) NOT NULL,
      outcome ENUM('delivered_with_issue','not_delivered') NOT NULL,
      reason ENUM('short','damaged','wrong_item','refused','absent','wrong_address','other') NOT NULL,
      qty_expected DECIMAL(12,2) NULL,
      qty_delivered DECIMAL(12,2) NULL,
      note VARCHAR(1000) NOT NULL,
      captured_lat DECIMAL(10,7) NULL,
      captured_lng DECIMAL(10,7) NULL,
      captured_at DATETIME NOT NULL,
      submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

      status ENUM('open','reattempt','returned','resolved') NOT NULL DEFAULT 'open',
      resolved_by INT UNSIGNED NULL,
      resolved_at DATETIME NULL,
      resolution_note VARCHAR(1000) NULL,

      UNIQUE KEY uq_delivery_report_ref (driver_id, client_ref),
      KEY idx_delivery_report_trip (trip_ticket_id, status),
      KEY idx_delivery_report_company (company_id, status, submitted_at),
      CONSTRAINT fk_delivery_report_trip FOREIGN KEY (trip_ticket_id) REFERENCES trip_tickets(trip_ticket_id),
      CONSTRAINT fk_delivery_report_driver FOREIGN KEY (driver_id) REFERENCES drivers(driver_id),
      CONSTRAINT fk_delivery_report_company FOREIGN KEY (company_id) REFERENCES companies(company_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS delivery_report_photos (
      photo_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      report_id BIGINT UNSIGNED NOT NULL,
      photo_path VARCHAR(500) NOT NULL,
      photo_mime VARCHAR(100) NOT NULL,
      photo_size INT UNSIGNED NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_delivery_report_photo (report_id),
      CONSTRAINT fk_delivery_report_photo FOREIGN KEY (report_id)
        REFERENCES delivery_reports(report_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // a report is an exception, linked back to it like pauses, requests and inspections
  const [[col]] = await conn.query(
    `SELECT COLUMN_TYPE AS type FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'operational_exceptions' AND COLUMN_NAME = 'source_kind'`
  );
  if (col && !/'delivery_report'/.test(col.type)) {
    await conn.query(
      "ALTER TABLE operational_exceptions MODIFY COLUMN source_kind ENUM('pause','support','inspection','delivery_report') NULL"
    );
  }
}
