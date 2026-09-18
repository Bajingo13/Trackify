/**
 * 027 — Who accepted the Terms of Service and Data Privacy Policy, and when.
 *
 * A row per user per version rather than a flag on the user, because the
 * agreement itself is the reason: section 2.2 says an updated version must be
 * accepted again, and section 4.2 commits the system to keeping an audit trail
 * for compliance. A column would be overwritten on the next version and the
 * record of what someone actually agreed to would be gone.
 *
 * The address and browser are kept because acceptance is a consent record under
 * the Data Privacy Act, and a consent record that cannot say where it came from
 * is difficult to stand behind later. Both are already collected and disclosed
 * in section 4.1.
 *
 * Idempotent.
 */
export async function up(conn) {
  const [existing] = await conn.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'agreement_acceptances'`
  );
  if (existing.length) return;

  await conn.query(`
    CREATE TABLE agreement_acceptances (
      acceptance_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id       INT UNSIGNED NOT NULL,

      -- the document version accepted, e.g. '1.0'
      version       VARCHAR(20) NOT NULL,
      accepted_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

      -- room for an IPv6 address; both are disclosed under section 4.1
      ip_address    VARCHAR(45) NULL,
      user_agent    VARCHAR(255) NULL,

      -- accepting twice is the same consent, not a second one
      UNIQUE KEY uq_agreement_user_version (user_id, version),
      INDEX idx_agreement_version (version),

      FOREIGN KEY (user_id) REFERENCES users(user_id)
    ) ENGINE=InnoDB
  `);
}
