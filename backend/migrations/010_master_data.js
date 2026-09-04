/**
 * 010 — Master data: suppliers, chart of accounts, tax codes.
 * (customers, warehouses, inventory_items already exist.) Idempotent.
 */
export async function up(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS suppliers (
      supplier_id    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      company_id     INT UNSIGNED NOT NULL,
      supplier_code  VARCHAR(20) NOT NULL,
      supplier_name  VARCHAR(160) NOT NULL,
      contact_person VARCHAR(120) NULL,
      phone          VARCHAR(50) NULL,
      email          VARCHAR(160) NULL,
      address        VARCHAR(255) NULL,
      tax_id         VARCHAR(40) NULL,
      status         ENUM('active','inactive') NOT NULL DEFAULT 'active',
      created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_supplier_code (company_id, supplier_code),
      FOREIGN KEY (company_id) REFERENCES companies(company_id)
    ) ENGINE=InnoDB
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS chart_of_accounts (
      account_id    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      company_id    INT UNSIGNED NOT NULL,
      account_code  VARCHAR(20) NOT NULL,
      account_name  VARCHAR(160) NOT NULL,
      account_type  ENUM('asset','liability','equity','income','expense') NOT NULL,
      description   VARCHAR(255) NULL,
      status        ENUM('active','inactive') NOT NULL DEFAULT 'active',
      created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_coa_code (company_id, account_code),
      FOREIGN KEY (company_id) REFERENCES companies(company_id)
    ) ENGINE=InnoDB
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS tax_codes (
      tax_code_id  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      company_id   INT UNSIGNED NOT NULL,
      code         VARCHAR(20) NOT NULL,
      name         VARCHAR(120) NOT NULL,
      rate         DECIMAL(6,3) NOT NULL DEFAULT 0,
      tax_type     ENUM('vat','percentage','exempt','withholding') NOT NULL DEFAULT 'vat',
      status       ENUM('active','inactive') NOT NULL DEFAULT 'active',
      created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_taxcode (company_id, code),
      FOREIGN KEY (company_id) REFERENCES companies(company_id)
    ) ENGINE=InnoDB
  `);

  const [[{ n: s }]] = await conn.query("SELECT COUNT(*) n FROM suppliers WHERE company_id = 1");
  if (s === 0) {
    await conn.query(
      `INSERT INTO suppliers (company_id, supplier_code, supplier_name, contact_person, phone, email, tax_id) VALUES
        (1,'SUP-0001','Petron Corporation','Ramon Ang','+63 2 8886 3888','fleet@petron.com','000-123-456-000'),
        (1,'SUP-0002','Motolite Batteries','Sales Desk','+63 2 8370 3333','orders@motolite.com','111-222-333-000'),
        (1,'SUP-0003','Yokohama Tire Philippines','Account Manager','+63 2 8888 1234','b2b@yokohama.ph','222-333-444-000'),
        (1,'SUP-0004','Shell Lubricants PH','Trade Team','+63 2 8878 5000','lubes@shell.com','333-444-555-000')`
    );
  }

  const [[{ n: c }]] = await conn.query("SELECT COUNT(*) n FROM chart_of_accounts WHERE company_id = 1");
  if (c === 0) {
    await conn.query(
      `INSERT INTO chart_of_accounts (company_id, account_code, account_name, account_type) VALUES
        (1,'1000','Cash on Hand','asset'),
        (1,'1100','Accounts Receivable','asset'),
        (1,'1200','Fuel & Supplies Inventory','asset'),
        (1,'2000','Accounts Payable','liability'),
        (1,'3000','Owner''s Equity','equity'),
        (1,'4000','Freight Revenue','income'),
        (1,'5000','Fuel Expense','expense'),
        (1,'5100','Vehicle Maintenance Expense','expense'),
        (1,'5200','Driver Salaries & Allowances','expense'),
        (1,'5300','Toll & Parking','expense')`
    );
  }

  const [[{ n: tx }]] = await conn.query("SELECT COUNT(*) n FROM tax_codes WHERE company_id = 1");
  if (tx === 0) {
    await conn.query(
      `INSERT INTO tax_codes (company_id, code, name, rate, tax_type) VALUES
        (1,'VAT12','Value Added Tax 12%',12.000,'vat'),
        (1,'VAT0','Zero-rated VAT',0.000,'vat'),
        (1,'EXEMPT','VAT Exempt',0.000,'exempt'),
        (1,'EWT2','Expanded Withholding Tax 2%',2.000,'withholding'),
        (1,'EWT1','Expanded Withholding Tax 1%',1.000,'withholding')`
    );
  }
}
