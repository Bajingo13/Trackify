/**
 * 021 — Structured proof of delivery.
 *
 * Confirming a delivery previously wrote one sentence into the trip's status
 * history: "POD — received by <name>". That is not a proof of delivery. In a
 * trucking operation the POD is the document that settles a dispute and
 * releases billing, so it needs to be a record: who signed for the load, when
 * and where the driver was standing when they captured it, and a photo.
 *
 * One POD per trip — the unique key on trip_ticket_id makes a duplicate
 * confirmation impossible at the database level, not just in the handler.
 *
 * Idempotent.
 */
export async function up(conn) {
  const [existing] = await conn.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trip_pod'`
  );
  if (existing.length) return;

  await conn.query(`
    CREATE TABLE trip_pod (
      pod_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      trip_ticket_id INT UNSIGNED NOT NULL,
      company_id INT UNSIGNED NOT NULL,
      driver_id INT UNSIGNED NULL,

      received_by VARCHAR(150) NOT NULL,
      note VARCHAR(255) NULL,

      -- where the driver was when they captured it, not where the trip was
      -- planned to end; null when the device refused or had no fix
      captured_lat DECIMAL(10,7) NULL,
      captured_lng DECIMAL(10,7) NULL,
      captured_at DATETIME NOT NULL,

      photo_path VARCHAR(500) NULL,
      photo_mime VARCHAR(100) NULL,
      photo_size INT UNSIGNED NULL,

      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

      UNIQUE KEY uq_trip_pod_trip (trip_ticket_id),
      KEY idx_trip_pod_company (company_id),
      CONSTRAINT fk_trip_pod_trip FOREIGN KEY (trip_ticket_id)
        REFERENCES trip_tickets(trip_ticket_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}
