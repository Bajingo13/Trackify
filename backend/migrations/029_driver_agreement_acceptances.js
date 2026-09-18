/**
 * 029 — Who accepted the Terms of Service in the Driver App, and when.
 *
 * Until this existed, a driver who only ever used the phone had no way to
 * accept the Agreement and no code path that would have let them: the
 * acceptance routes sit behind the staff `authenticate` middleware, which
 * rejects a Driver App token outright, and a driver has no users row to record
 * an acceptance against. Section 4.3 offered consent-by-acceptance as a legal
 * basis for exactly the collection described in 4.1.1 — driver location — from
 * the one group that could not give it. That is a disclosure defect under the
 * Data Privacy Act, not an inconvenience.
 *
 * A separate table rather than a driver_id column on agreement_acceptances.
 * That table is a consent record with a NOT NULL foreign key to users and a
 * unique key across (user_id, version); making it polymorphic would mean
 * dropping the constraint that guarantees one consent per user per version, and
 * loosening the integrity of an existing legal record to accommodate a new one
 * is the wrong trade. Two tables, each with its own key, each provably correct.
 *
 * Everything else mirrors 027 deliberately: a row per driver per version, so a
 * revision under section 2.2 is a new consent rather than an overwrite, and the
 * address and browser are kept because a consent record that cannot say where
 * it came from is hard to stand behind later.
 *
 * Idempotent.
 */
export async function up(conn) {
  const [existing] = await conn.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'driver_agreement_acceptances'`
  );
  if (existing.length) return;

  await conn.query(`
    CREATE TABLE driver_agreement_acceptances (
      acceptance_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      driver_id     INT UNSIGNED NOT NULL,

      -- the document version accepted, e.g. '1.3'
      version       VARCHAR(20) NOT NULL,
      accepted_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

      -- room for an IPv6 address; both are disclosed under section 4.1
      ip_address    VARCHAR(45) NULL,
      user_agent    VARCHAR(255) NULL,

      -- accepting twice is the same consent, not a second one
      UNIQUE KEY uq_driver_agreement_version (driver_id, version),
      INDEX idx_driver_agreement_version (version),

      FOREIGN KEY (driver_id) REFERENCES drivers(driver_id)
    ) ENGINE=InnoDB
  `);
}
