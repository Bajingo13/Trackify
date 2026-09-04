/**
 * 009 — Cargo release / return
 *
 * Warehouse-side handover of a trip's physical cargo: "release" hands it to the
 * assigned driver at dispatch; "return" logs undelivered cargo coming back.
 * Ties to trip_tickets. Idempotent.
 */
export async function up(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS cargo_events (
      cargo_event_id  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      company_id      INT UNSIGNED NOT NULL,
      branch_id       INT UNSIGNED NULL,
      trip_ticket_id  INT UNSIGNED NOT NULL,
      event_type      ENUM('release','return') NOT NULL,
      quantity        INT NULL,
      cargo_condition ENUM('good','damaged','partial') NOT NULL DEFAULT 'good',
      counterparty    VARCHAR(120) NULL,
      reason          VARCHAR(255) NULL,
      notes           VARCHAR(255) NULL,
      handled_by      INT UNSIGNED NULL,
      created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (company_id) REFERENCES companies(company_id),
      FOREIGN KEY (trip_ticket_id) REFERENCES trip_tickets(trip_ticket_id),
      INDEX idx_cargo_trip (trip_ticket_id, event_type)
    ) ENGINE=InnoDB
  `);
}
