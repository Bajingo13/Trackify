/**
 * 034 — Settings that actually change something.
 *
 * Two screens have rendered a placeholder since the interface was built. The
 * temptation with a settings page is to fill it with controls that look right,
 * and a toggle that changes nothing is the same lie as a document describing a
 * feature that does not exist — worse, because somebody will set it and
 * believe it took.
 *
 * So this holds only what is wired to behaviour on the day it ships:
 *
 *   • trip_prefix — the letters at the front of a trip ticket number. The
 *     generator hardcoded "TT" while the seeded data used "DVO", which is the
 *     clearest evidence that companies want their own.
 *
 *   • location_retention_months — how long the location trail is kept before
 *     it is deleted. It existed only as an environment variable, which means
 *     the operator could not see it, let alone set it, while the privacy
 *     policy quotes a number to the people it is about.
 *
 * And per-user alert mutes, which filter what a person sees on the exceptions
 * board. Mutes rather than subscriptions: alerts are raised by the system for
 * operational reasons, and the default has to be that you see them. Somebody
 * who has never opened this page must not be missing a failed delivery.
 *
 * Idempotent.
 */
export async function up(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS company_settings (
      company_id INT UNSIGNED PRIMARY KEY,

      -- the letters in front of a trip ticket number, e.g. TT-2026-000123
      trip_prefix VARCHAR(10) NOT NULL DEFAULT 'TT',

      -- how long the position trail outlives the trip it belongs to
      location_retention_months SMALLINT UNSIGNED NOT NULL DEFAULT 12,

      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      updated_by INT UNSIGNED NULL,

      FOREIGN KEY (company_id) REFERENCES companies(company_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  /*
   * A row per thing a person does not want to see, rather than a row per thing
   * they do. An empty table means everybody sees everything, which is the only
   * safe default for alerts about failed deliveries and expired licences.
   */
  await conn.query(`
    CREATE TABLE IF NOT EXISTS user_alert_mutes (
      user_id INT UNSIGNED NOT NULL,
      exception_type VARCHAR(60) NOT NULL,
      muted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

      PRIMARY KEY (user_id, exception_type),
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}
