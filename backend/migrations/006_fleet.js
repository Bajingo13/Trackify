/**
 * 006 — Fleet master data (Phase 2 · 2A)
 *
 * - extends `vehicles` and `drivers` with the fields the Fleet screens use
 * - adds `vehicle_maintenance` and `compliance_documents`
 *
 * Idempotent. Fleet permissions were already added in migration 005.
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
  await addColumn(conn, "vehicles", "brand", "brand VARCHAR(80) NULL AFTER vehicle_type");
  await addColumn(conn, "vehicles", "model", "model VARCHAR(80) NULL AFTER brand");
  await addColumn(conn, "vehicles", "year", "year SMALLINT UNSIGNED NULL AFTER model");
  await addColumn(conn, "vehicles", "color", "color VARCHAR(40) NULL AFTER year");
  await addColumn(conn, "vehicles", "insurance_expiry", "insurance_expiry DATE NULL AFTER registration_expiry");

  await addColumn(conn, "drivers", "license_type", "license_type VARCHAR(40) NULL AFTER license_no");
  await addColumn(conn, "drivers", "emergency_contact_name", "emergency_contact_name VARCHAR(120) NULL");
  await addColumn(conn, "drivers", "emergency_contact_phone", "emergency_contact_phone VARCHAR(50) NULL");
  await addColumn(conn, "drivers", "emergency_contact_relation", "emergency_contact_relation VARCHAR(60) NULL");

  await conn.query(`
    CREATE TABLE IF NOT EXISTS vehicle_maintenance (
      maintenance_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      company_id INT UNSIGNED NOT NULL,
      vehicle_id INT UNSIGNED NOT NULL,
      maintenance_type VARCHAR(80) NOT NULL,
      description VARCHAR(500) NULL,
      scheduled_date DATE NULL,
      completed_date DATE NULL,
      odometer_reading DECIMAL(12,2) NULL,
      cost DECIMAL(12,2) NULL,
      vendor VARCHAR(160) NULL,
      notes TEXT NULL,
      status ENUM('scheduled','in_progress','completed','cancelled') NOT NULL DEFAULT 'scheduled',
      created_by INT UNSIGNED NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_vm_vehicle (vehicle_id),
      INDEX idx_vm_company_status (company_id, status),
      FOREIGN KEY (company_id) REFERENCES companies(company_id),
      FOREIGN KEY (vehicle_id) REFERENCES vehicles(vehicle_id)
    ) ENGINE=InnoDB
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS compliance_documents (
      document_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      company_id INT UNSIGNED NOT NULL,
      entity_type ENUM('driver','vehicle') NOT NULL,
      entity_id INT UNSIGNED NOT NULL,
      doc_type VARCHAR(80) NOT NULL,
      doc_number VARCHAR(120) NULL,
      issue_date DATE NULL,
      expiry_date DATE NULL,
      reference VARCHAR(255) NULL,
      notes TEXT NULL,
      created_by INT UNSIGNED NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_cd_entity (entity_type, entity_id),
      INDEX idx_cd_company_expiry (company_id, expiry_date),
      FOREIGN KEY (company_id) REFERENCES companies(company_id)
    ) ENGINE=InnoDB
  `);
}
