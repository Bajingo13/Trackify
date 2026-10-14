/**
 * 049 — Driver Help & Support.
 *
 * A driver who needs something from the office — a problem on the road, a
 * payment question, an app that will not sign in — files a request from the
 * Driver app and gets answers back in the same place.
 *
 * support_tickets is the request: who raised it, what kind, how urgent, and
 * where it stands. support_messages is the conversation under it. Nothing is
 * ever edited or deleted by either side, so what was said can be relied on.
 *
 * branch_id is the branch whose staff handle it: the branch of the trip the
 * driver linked to, or else their home branch. Staff see the tickets of the
 * branch they are operating in, the same rule as every other branch screen.
 *
 * client_ref is chosen by the driver's phone. A request filed out of signal is
 * parked in the outbox and replayed later, possibly twice if the first reply is
 * lost; the unique keys make the second arrival a no-op instead of a duplicate.
 *
 * *_last_read_message_id hold how far each side has read, so "you have an
 * answer" and "a driver wrote back" are a comparison, not a table of reads.
 *
 * Also grants support.read / support.manage to the roles that answer drivers,
 * in every company. Additive and idempotent.
 */
import { provisionAllCompanies } from "../src/shared/provisionRoles.js";

export async function up(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS support_tickets (
      ticket_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      company_id INT UNSIGNED NOT NULL,
      branch_id INT UNSIGNED NOT NULL,
      driver_id INT UNSIGNED NOT NULL,
      -- As it read when filed, so the request still says who raised it after a rename.
      driver_name VARCHAR(150) NOT NULL,
      trip_ticket_id INT UNSIGNED NULL,

      category ENUM('trip','vehicle','payment','app','safety','account','other') NOT NULL DEFAULT 'other',
      priority ENUM('normal','urgent') NOT NULL DEFAULT 'normal',
      subject VARCHAR(120) NOT NULL,
      status ENUM('open','in_progress','resolved','closed') NOT NULL DEFAULT 'open',

      assigned_user_id INT UNSIGNED NULL,
      assigned_name VARCHAR(150) NULL,
      client_ref VARCHAR(64) NULL,

      driver_last_read_message_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
      staff_last_read_message_id BIGINT UNSIGNED NOT NULL DEFAULT 0,

      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      resolved_at DATETIME(3) NULL,

      UNIQUE KEY uq_support_ticket_client_ref (driver_id, client_ref),
      KEY ix_support_tickets_driver (driver_id, ticket_id),
      KEY ix_support_tickets_scope (company_id, branch_id, status, updated_at),

      FOREIGN KEY (driver_id) REFERENCES drivers(driver_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS support_messages (
      message_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      ticket_id BIGINT UNSIGNED NOT NULL,

      sender_kind ENUM('driver','staff') NOT NULL,
      sender_user_id INT UNSIGNED NULL,
      sender_driver_id INT UNSIGNED NULL,
      sender_name VARCHAR(150) NOT NULL,

      body VARCHAR(2000) NOT NULL,
      client_ref VARCHAR(64) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

      UNIQUE KEY uq_support_message_client_ref (ticket_id, client_ref),
      KEY ix_support_messages_thread (ticket_id, message_id),

      FOREIGN KEY (ticket_id) REFERENCES support_tickets(ticket_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await provisionAllCompanies(conn);
}
