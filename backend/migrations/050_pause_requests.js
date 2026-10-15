/**
 * 050 — Pause requests and customer tracking links.
 *
 * A driver who meets a legitimate interruption — a breakdown, an accident, a
 * flooded road — asks the office to pause the delivery rather than be read as
 * having stopped for no reason. The request carries a reason, a description and
 * photographs, the time it was made and where the truck was; the office
 * approves or declines it; and while an approved pause is open, the delivery is
 * shown as paused (with the reason) instead of as a truck that has gone quiet.
 *
 * The trip's own status is untouched: a pause is a record laid over an
 * in-transit trip, not a new state in its lifecycle, so every screen and report
 * that reads trip statuses keeps meaning what it meant.
 *
 * Every pause has a support ticket, created with it, so the conversation with
 * the office, the history and the tracking of the request are the same ones the
 * rest of Help & Support uses.
 *
 * trip_tracking_links are what a customer is given to see their delivery: an
 * unguessable token, valid for a while, revocable, read-only. There is no
 * customer login in this system, so the link is the customer's way in.
 *
 * Every pause, and every driver concern about a trip, a truck or safety, is also
 * an operational exception — so it appears in the one panel the office already
 * works from, and its status follows the pause or the request it came from.
 *
 * Also grants tracking.share to the roles that hand customers their link.
 * Additive and idempotent.
 */
import { provisionAllCompanies } from "../src/shared/provisionRoles.js";

export async function up(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS trip_pauses (
      pause_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      company_id INT UNSIGNED NOT NULL,
      branch_id INT UNSIGNED NOT NULL,
      trip_ticket_id INT UNSIGNED NOT NULL,
      driver_id INT UNSIGNED NOT NULL,
      -- As it read when requested, so the record still says who asked after a rename.
      driver_name VARCHAR(150) NOT NULL,
      ticket_id BIGINT UNSIGNED NULL,

      reason ENUM('breakdown','emergency','incident','delay','other') NOT NULL,
      description VARCHAR(2000) NOT NULL,
      latitude DECIMAL(10,7) NULL,
      longitude DECIMAL(10,7) NULL,

      -- pending: waiting for the office. approved: the pause is on.
      -- declined: refused. resumed: ended after it was approved.
      -- cancelled: withdrawn by the driver while it was still pending.
      status ENUM('pending','approved','declined','resumed','cancelled') NOT NULL DEFAULT 'pending',
      requested_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

      reviewed_at DATETIME(3) NULL,
      reviewed_by_user_id INT UNSIGNED NULL,
      reviewed_by_name VARCHAR(150) NULL,
      review_note VARCHAR(500) NULL,
      -- What the customer is shown. Written by the office; never the driver's own words.
      customer_message VARCHAR(300) NULL,

      resumed_at DATETIME(3) NULL,
      resumed_by ENUM('driver','staff','delivery') NULL,

      client_ref VARCHAR(64) NULL,

      UNIQUE KEY uq_trip_pause_client_ref (driver_id, client_ref),
      KEY ix_trip_pauses_trip (trip_ticket_id, status),
      KEY ix_trip_pauses_driver (driver_id, pause_id),
      KEY ix_trip_pauses_scope (company_id, branch_id, status, requested_at),

      FOREIGN KEY (trip_ticket_id) REFERENCES trip_tickets(trip_ticket_id) ON DELETE CASCADE,
      FOREIGN KEY (driver_id) REFERENCES drivers(driver_id) ON DELETE CASCADE,
      FOREIGN KEY (ticket_id) REFERENCES support_tickets(ticket_id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS trip_pause_photos (
      photo_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      pause_id BIGINT UNSIGNED NOT NULL,
      photo_path VARCHAR(255) NOT NULL,
      photo_mime VARCHAR(100) NOT NULL,
      photo_size INT UNSIGNED NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

      KEY ix_trip_pause_photos_pause (pause_id),
      FOREIGN KEY (pause_id) REFERENCES trip_pauses(pause_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS trip_tracking_links (
      link_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      company_id INT UNSIGNED NOT NULL,
      branch_id INT UNSIGNED NOT NULL,
      trip_ticket_id INT UNSIGNED NOT NULL,

      -- 32 random bytes, URL-safe. It is the whole credential: whoever holds the
      -- link may see this one delivery's status, and nothing else.
      token VARCHAR(64) NOT NULL,
      created_by_user_id INT UNSIGNED NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      expires_at DATETIME(3) NOT NULL,
      revoked_at DATETIME(3) NULL,
      last_viewed_at DATETIME(3) NULL,
      view_count INT UNSIGNED NOT NULL DEFAULT 0,

      UNIQUE KEY uq_trip_tracking_token (token),
      KEY ix_trip_tracking_trip (trip_ticket_id, revoked_at),

      FOREIGN KEY (trip_ticket_id) REFERENCES trip_tickets(trip_ticket_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // An exception can now come from a driver: a pause request, or a concern
  // filed in Help & Support. These say which, so the exception and its source
  // keep each other's status, and so a source has one exception, never two.
  const [cols] = await conn.query("SHOW COLUMNS FROM operational_exceptions LIKE 'source_kind'");
  if (!cols.length) {
    await conn.query(`
      ALTER TABLE operational_exceptions
        ADD COLUMN source_kind ENUM('pause','support') NULL AFTER trip_ticket_id,
        ADD COLUMN source_id BIGINT UNSIGNED NULL AFTER source_kind,
        ADD UNIQUE KEY uq_exceptions_source (source_kind, source_id)
    `);
  }

  await provisionAllCompanies(conn);
}
