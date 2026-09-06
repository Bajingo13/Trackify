/**
 * 019 — Driver-submitted trip expenses with receipt photos.
 *
 * A driver can log fuel, tolls and the like from the road and attach a photo
 * of the receipt. Those land as `submitted`, which is deliberately outside
 * the voucher flow: only a finance or branch reviewer moving one to
 * `recorded` lets it reach a voucher, so nothing a driver types posts to the
 * books unreviewed. A rejected claim keeps its row and its reason.
 *
 * Adds:
 *   trip_expenses.status          + 'submitted' and 'rejected'
 *   trip_expenses.submitted_by_driver_id, reviewed_by, reviewed_at, review_note
 *   expense_attachments           receipt files, on disk, referenced here
 *
 * Idempotent.
 */
export async function up(conn) {
  const hasColumn = async (table, column) => {
    const [rows] = await conn.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column]
    );
    return rows.length > 0;
  };

  // widen the lifecycle: a claim is submitted -> recorded (approved) or rejected
  const [statusCol] = await conn.query(
    `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trip_expenses' AND COLUMN_NAME = 'status'`
  );
  if (statusCol.length && !String(statusCol[0].COLUMN_TYPE).includes("submitted")) {
    await conn.query(
      `ALTER TABLE trip_expenses
        MODIFY COLUMN status
          ENUM('submitted','recorded','on_voucher','reimbursed','rejected')
          NOT NULL DEFAULT 'recorded'`
    );
  }

  if (!(await hasColumn("trip_expenses", "submitted_by_driver_id"))) {
    await conn.query(
      `ALTER TABLE trip_expenses
         ADD COLUMN submitted_by_driver_id INT UNSIGNED NULL AFTER created_by,
         ADD COLUMN reviewed_by INT UNSIGNED NULL AFTER submitted_by_driver_id,
         ADD COLUMN reviewed_at DATETIME NULL AFTER reviewed_by,
         ADD COLUMN review_note VARCHAR(255) NULL AFTER reviewed_at`
    );
    await conn.query(
      `ALTER TABLE trip_expenses
         ADD INDEX idx_trip_expenses_submitted_driver (submitted_by_driver_id)`
    );
  }

  const [attach] = await conn.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'expense_attachments'`
  );
  if (!attach.length) {
    await conn.query(`
      CREATE TABLE expense_attachments (
        attachment_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        expense_id INT UNSIGNED NOT NULL,
        company_id INT UNSIGNED NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        mime_type VARCHAR(100) NOT NULL,
        byte_size INT UNSIGNED NOT NULL,
        storage_path VARCHAR(500) NOT NULL,
        uploaded_by_driver_id INT UNSIGNED NULL,
        uploaded_by_user_id INT UNSIGNED NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (expense_id) REFERENCES trip_expenses(expense_id) ON DELETE CASCADE,
        INDEX idx_expense_attachments_expense (expense_id),
        INDEX idx_expense_attachments_company (company_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  }
}
