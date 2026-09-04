/**
 * 018 — Maintenance parts, consumed from inventory on completion.
 *
 * A maintenance job can list the parts it needs (picked from the item
 * catalog). When the job is marked completed, those quantities are deducted
 * from the vehicle's home-branch stock (same guarded pattern as a stock
 * "Issue" movement — insufficient stock blocks completion) and a
 * stock_movements row is written for the audit trail.
 *
 * Idempotent.
 */
export async function up(conn) {
  const [tables] = await conn.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'maintenance_parts'`
  );
  if (tables.length) return;

  await conn.query(`
    CREATE TABLE maintenance_parts (
      maintenance_part_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      maintenance_id INT UNSIGNED NOT NULL,
      item_id INT UNSIGNED NOT NULL,
      quantity DECIMAL(10,2) NOT NULL,
      consumed TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (maintenance_id) REFERENCES vehicle_maintenance(maintenance_id) ON DELETE CASCADE,
      FOREIGN KEY (item_id) REFERENCES inventory_items(item_id),
      INDEX (maintenance_id)
    ) ENGINE=InnoDB
  `);
}
