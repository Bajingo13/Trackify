/**
 * 039 — Trip chat between the driver and dispatch.
 *
 * One thread per trip, like a ride-hailing chat: it exists while the trip is
 * running and stays on the trip afterwards as the record of what was said —
 * the gate that would not open, the consignee who asked for a later drop.
 *
 * Messages are never edited or deleted by either side, so the thread can be
 * relied on when a delivery is disputed.
 *
 * client_ref is chosen by the sender's device. A driver out of signal has the
 * message parked in the phone's outbox and replayed later, possibly twice if
 * the first reply is lost on a bad connection; the unique key makes the second
 * arrival a no-op instead of a duplicate message.
 *
 * trip_message_reads holds how far each reader has read, one row per person
 * per trip, so unread counts are a comparison and not a per-message table.
 *
 * Idempotent.
 */
export async function up(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS trip_messages (
      message_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      company_id INT UNSIGNED NOT NULL,
      branch_id INT UNSIGNED NOT NULL,
      trip_ticket_id INT UNSIGNED NOT NULL,

      sender_kind ENUM('driver','staff') NOT NULL,
      sender_user_id INT UNSIGNED NULL,
      sender_driver_id INT UNSIGNED NULL,
      -- As it read when sent, so the thread still says who spoke after a rename.
      sender_name VARCHAR(150) NOT NULL,

      body VARCHAR(1000) NOT NULL,
      client_ref VARCHAR(64) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

      UNIQUE KEY uq_trip_message_client_ref (trip_ticket_id, client_ref),
      KEY ix_trip_messages_thread (trip_ticket_id, message_id),
      KEY ix_trip_messages_scope (company_id, branch_id, message_id),

      FOREIGN KEY (trip_ticket_id) REFERENCES trip_tickets(trip_ticket_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS trip_message_reads (
      trip_ticket_id INT UNSIGNED NOT NULL,
      reader_kind ENUM('driver','staff') NOT NULL,
      reader_id INT UNSIGNED NOT NULL,
      last_read_message_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

      PRIMARY KEY (trip_ticket_id, reader_kind, reader_id),

      FOREIGN KEY (trip_ticket_id) REFERENCES trip_tickets(trip_ticket_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}
