/**
 * 065 — Free, explainable smart-dispatch recommendations.
 *
 * A trip may name the vehicle type it actually needs. Recommendation snapshots
 * preserve the ranked options and their reasons so a later assignment can be
 * explained without calling an external service or recreating old fleet state.
 * Additive and idempotent.
 */

async function hasColumn(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows.length > 0;
}

export async function up(conn) {
  if (!(await hasColumn(conn, "trip_tickets", "required_vehicle_type"))) {
    await conn.query(
      "ALTER TABLE trip_tickets ADD COLUMN required_vehicle_type VARCHAR(100) NULL AFTER cargo_weight"
    );
  }

  await conn.query(`
    CREATE TABLE IF NOT EXISTS dispatch_recommendation_runs (
      recommendation_id CHAR(36) PRIMARY KEY,
      company_id INT UNSIGNED NOT NULL,
      branch_id INT UNSIGNED NOT NULL,
      trip_ticket_id INT UNSIGNED NOT NULL,
      requested_by INT UNSIGNED NULL,
      driver_rankings JSON NOT NULL,
      vehicle_rankings JSON NOT NULL,
      scoring_version VARCHAR(30) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_dispatch_rec_trip_time (company_id, branch_id, trip_ticket_id, created_at),
      FOREIGN KEY (company_id) REFERENCES companies(company_id),
      FOREIGN KEY (branch_id) REFERENCES branches(branch_id),
      FOREIGN KEY (trip_ticket_id) REFERENCES trip_tickets(trip_ticket_id),
      FOREIGN KEY (requested_by) REFERENCES users(user_id)
    ) ENGINE=InnoDB
  `);
}
