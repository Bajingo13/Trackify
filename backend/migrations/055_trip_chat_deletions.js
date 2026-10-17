/**
 * 055 — Per-user deletion of a trip conversation.
 *
 * A chat is also an operational record, so deleting it from one person's
 * inbox must not erase it for the driver, dispatch, or an audit.  This table
 * records the point through which that reader chose to clear the thread.
 * Messages (and a completion event) created later are visible normally.
 *
 * Idempotent.
 */
export async function up(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS trip_chat_deletions (
      trip_ticket_id INT UNSIGNED NOT NULL,
      reader_kind ENUM('driver','staff') NOT NULL,
      reader_id INT UNSIGNED NOT NULL,
      deleted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

      PRIMARY KEY (trip_ticket_id, reader_kind, reader_id),
      KEY ix_trip_chat_deletions_reader (reader_kind, reader_id, deleted_at),

      FOREIGN KEY (trip_ticket_id) REFERENCES trip_tickets(trip_ticket_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}
