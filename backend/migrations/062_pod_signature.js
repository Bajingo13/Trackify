/**
 * 062 — The receiver's signature on the proof of delivery.
 *
 * The driver can have the person receiving the load sign on the phone at
 * "Confirm delivery". When the company requires it
 * (company_settings.require_signature) a delivery needs either the signature
 * or the reason there is none — refused, not present, unable to sign — and
 * still goes through with its photo either way, so a receiver who will not
 * sign never strands a load at the door.
 *
 *   trip_pod.signature_*   the drawing (a PNG, stored like the POD photo), its
 *                          size and sha256, and when it was signed. Kept as
 *                          long as the POD itself, and served only to people
 *                          who can read the trip — never on the public
 *                          tracking page.
 *   trip_pod.unsigned_reason  why there is no signature, when there is none.
 *
 * Additive and idempotent.
 */

const hasColumn = async (conn, table, column) => {
  const [rows] = await conn.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows.length > 0;
};

const POD_COLUMNS = [
  ["signature_path", "VARCHAR(500) NULL"],
  ["signature_mime", "VARCHAR(100) NULL"],
  ["signature_size", "INT UNSIGNED NULL"],
  ["signature_sha256", "CHAR(64) NULL"],
  ["signed_at", "DATETIME NULL"],
  ["unsigned_reason", "ENUM('refused','not_present','unable') NULL"],
];

export async function up(conn) {
  for (const [column, type] of POD_COLUMNS) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await hasColumn(conn, "trip_pod", column))) {
      // eslint-disable-next-line no-await-in-loop
      await conn.query(`ALTER TABLE trip_pod ADD COLUMN ${column} ${type}`);
    }
  }
  if (!(await hasColumn(conn, "company_settings", "require_signature"))) {
    await conn.query("ALTER TABLE company_settings ADD COLUMN require_signature TINYINT(1) NOT NULL DEFAULT 0");
  }
}
