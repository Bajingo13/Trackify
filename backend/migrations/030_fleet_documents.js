/**
 * 030 — Somewhere to keep the actual document.
 *
 * Three records already describe a piece of paper without being able to hold
 * it. A driver row carries a licence number, type and expiry but no photograph
 * of the licence. A compliance_documents row records that a registration or
 * insurance certificate exists and when it lapses, with nowhere to put the
 * certificate. A vehicle_maintenance row records a cost and a vendor with
 * nowhere to put the receipt that proves it.
 *
 * Each gets the shape that actually fits it rather than one polymorphic table:
 *
 *   • the licence is one photograph belonging to one driver, so it sits on the
 *     driver row exactly as the profile photo already does
 *   • a compliance document row IS one document, so the file belongs on it
 *   • a maintenance job has several pieces of paper — parts invoice, labour
 *     receipt, warranty slip — so those get a table of their own
 *
 * Every one keeps a real foreign key. A shared attachments table keyed by a
 * type string would have lost that, and an orphaned receipt is worse than a
 * missing one: it looks like evidence of something.
 *
 * Bytes stay on disk under UPLOAD_ROOT; only the relative path is stored, the
 * same arrangement expense_attachments has used since migration 019.
 *
 * Idempotent.
 */

async function hasColumn(conn, table, column) {
  const [rows] = await conn.query("SHOW COLUMNS FROM ?? LIKE ?", [table, column]);
  return rows.length > 0;
}

async function addColumn(conn, table, column, ddl) {
  if (!(await hasColumn(conn, table, column))) {
    await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN ${ddl}`);
  }
}

export async function up(conn) {
  /* The driver's licence, photographed. Mirrors photo_* on the same row. */
  await addColumn(conn, "drivers", "license_photo_path", "license_photo_path VARCHAR(500) NULL AFTER license_expiry");
  await addColumn(conn, "drivers", "license_photo_mime", "license_photo_mime VARCHAR(100) NULL AFTER license_photo_path");
  await addColumn(conn, "drivers", "license_photo_size", "license_photo_size INT UNSIGNED NULL AFTER license_photo_mime");
  await addColumn(conn, "drivers", "license_photo_updated_at", "license_photo_updated_at DATETIME NULL AFTER license_photo_size");
  /* Who put it there. A driver photographs their own from the app; the office
   * may also upload one during onboarding, and later it matters which. */
  await addColumn(conn, "drivers", "license_photo_by_driver", "license_photo_by_driver TINYINT(1) NOT NULL DEFAULT 0 AFTER license_photo_updated_at");

  /* The certificate itself, on the row that already tracks its expiry. */
  await addColumn(conn, "compliance_documents", "file_path", "file_path VARCHAR(500) NULL AFTER notes");
  await addColumn(conn, "compliance_documents", "file_name", "file_name VARCHAR(255) NULL AFTER file_path");
  await addColumn(conn, "compliance_documents", "file_mime", "file_mime VARCHAR(100) NULL AFTER file_name");
  await addColumn(conn, "compliance_documents", "file_size", "file_size INT UNSIGNED NULL AFTER file_mime");
  await addColumn(conn, "compliance_documents", "file_uploaded_at", "file_uploaded_at DATETIME NULL AFTER file_size");
  await addColumn(conn, "compliance_documents", "file_uploaded_by", "file_uploaded_by INT UNSIGNED NULL AFTER file_uploaded_at");

  /* Receipts against a maintenance job. Several per job is the normal case. */
  await conn.query(`
    CREATE TABLE IF NOT EXISTS maintenance_attachments (
      attachment_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      maintenance_id INT UNSIGNED NOT NULL,
      company_id INT UNSIGNED NOT NULL,
      kind ENUM('receipt','invoice','quote','warranty','photo','other') NOT NULL DEFAULT 'receipt',
      file_name VARCHAR(255) NOT NULL,
      mime_type VARCHAR(100) NOT NULL,
      byte_size INT UNSIGNED NOT NULL,
      storage_path VARCHAR(500) NOT NULL,
      note VARCHAR(255) NULL,
      uploaded_by_user_id INT UNSIGNED NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

      -- deleting the job takes its paperwork with it, as expense_attachments does
      FOREIGN KEY (maintenance_id) REFERENCES vehicle_maintenance(maintenance_id) ON DELETE CASCADE,
      INDEX idx_maint_attachments_job (maintenance_id),
      INDEX idx_maint_attachments_company (company_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}
