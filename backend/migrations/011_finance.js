/**
 * 011 — Finance module: trip expenses, expense vouchers, invoices,
 * journal entries, and the BIR / EIS register. Idempotent.
 *
 * Depends on: trip_tickets, customers (001), chart_of_accounts (010), users, branches.
 */
export async function up(conn) {
  /* ---------------------------------------------------------------- */
  /* Trip expenses — costs incurred while running a trip              */
  /* ---------------------------------------------------------------- */
  await conn.query(`
    CREATE TABLE IF NOT EXISTS trip_expenses (
      expense_id     INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      company_id     INT UNSIGNED NOT NULL,
      branch_id      INT UNSIGNED NOT NULL,
      trip_ticket_id INT UNSIGNED NULL,
      category       ENUM('fuel','toll','parking','meals','lodging','repair','misc') NOT NULL DEFAULT 'misc',
      description    VARCHAR(255) NULL,
      amount         DECIMAL(12,2) NOT NULL DEFAULT 0,
      expense_date   DATE NOT NULL,
      receipt_no     VARCHAR(60) NULL,
      status         ENUM('recorded','on_voucher','reimbursed') NOT NULL DEFAULT 'recorded',
      voucher_id     INT UNSIGNED NULL,
      created_by     INT UNSIGNED NULL,
      created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_te_trip (trip_ticket_id),
      INDEX idx_te_voucher (voucher_id),
      INDEX idx_te_company_date (company_id, expense_date),
      FOREIGN KEY (trip_ticket_id) REFERENCES trip_tickets(trip_ticket_id) ON DELETE SET NULL
    ) ENGINE=InnoDB
  `);

  /* ---------------------------------------------------------------- */
  /* Expense vouchers — cash-out documents (accounts payable)         */
  /* ---------------------------------------------------------------- */
  await conn.query(`
    CREATE TABLE IF NOT EXISTS expense_vouchers (
      voucher_id    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      company_id    INT UNSIGNED NOT NULL,
      branch_id     INT UNSIGNED NOT NULL,
      voucher_no    VARCHAR(30) NOT NULL,
      payee         VARCHAR(160) NOT NULL,
      purpose       VARCHAR(255) NULL,
      total_amount  DECIMAL(12,2) NOT NULL DEFAULT 0,
      status        ENUM('draft','submitted','approved','rejected','paid') NOT NULL DEFAULT 'draft',
      notes         VARCHAR(255) NULL,
      submitted_by  INT UNSIGNED NULL,
      submitted_at  DATETIME NULL,
      approved_by   INT UNSIGNED NULL,
      approved_at   DATETIME NULL,
      paid_at       DATETIME NULL,
      created_by    INT UNSIGNED NULL,
      created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_voucher_no (company_id, voucher_no),
      INDEX idx_ev_status (company_id, status)
    ) ENGINE=InnoDB
  `);
  await conn.query(`
    CREATE TABLE IF NOT EXISTS expense_voucher_lines (
      line_id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      voucher_id      INT UNSIGNED NOT NULL,
      description     VARCHAR(255) NOT NULL,
      amount          DECIMAL(12,2) NOT NULL DEFAULT 0,
      trip_expense_id INT UNSIGNED NULL,
      FOREIGN KEY (voucher_id) REFERENCES expense_vouchers(voucher_id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);

  /* ---------------------------------------------------------------- */
  /* Invoices — billing customers for freight (accounts receivable)   */
  /* ---------------------------------------------------------------- */
  await conn.query(`
    CREATE TABLE IF NOT EXISTS invoices (
      invoice_id   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      company_id   INT UNSIGNED NOT NULL,
      branch_id    INT UNSIGNED NOT NULL,
      invoice_no   VARCHAR(30) NOT NULL,
      customer_id  INT UNSIGNED NOT NULL,
      invoice_date DATE NOT NULL,
      due_date     DATE NULL,
      subtotal     DECIMAL(12,2) NOT NULL DEFAULT 0,
      tax_amount   DECIMAL(12,2) NOT NULL DEFAULT 0,
      total        DECIMAL(12,2) NOT NULL DEFAULT 0,
      amount_paid  DECIMAL(12,2) NOT NULL DEFAULT 0,
      status       ENUM('draft','sent','partial','paid','void') NOT NULL DEFAULT 'draft',
      notes        VARCHAR(255) NULL,
      created_by   INT UNSIGNED NULL,
      created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_invoice_no (company_id, invoice_no),
      INDEX idx_inv_customer (customer_id),
      INDEX idx_inv_status (company_id, status),
      FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
    ) ENGINE=InnoDB
  `);
  await conn.query(`
    CREATE TABLE IF NOT EXISTS invoice_lines (
      line_id        INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      invoice_id     INT UNSIGNED NOT NULL,
      description    VARCHAR(255) NOT NULL,
      trip_ticket_id INT UNSIGNED NULL,
      quantity       DECIMAL(10,2) NOT NULL DEFAULT 1,
      unit_price     DECIMAL(12,2) NOT NULL DEFAULT 0,
      amount         DECIMAL(12,2) NOT NULL DEFAULT 0,
      FOREIGN KEY (invoice_id) REFERENCES invoices(invoice_id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);

  /* ---------------------------------------------------------------- */
  /* Journal entries — general-ledger postings                        */
  /* ---------------------------------------------------------------- */
  await conn.query(`
    CREATE TABLE IF NOT EXISTS journal_entries (
      entry_id     INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      company_id   INT UNSIGNED NOT NULL,
      branch_id    INT UNSIGNED NOT NULL,
      entry_no     VARCHAR(30) NOT NULL,
      entry_date   DATE NOT NULL,
      memo         VARCHAR(255) NULL,
      reference    VARCHAR(120) NULL,
      status       ENUM('draft','posted','void') NOT NULL DEFAULT 'draft',
      total_debit  DECIMAL(14,2) NOT NULL DEFAULT 0,
      total_credit DECIMAL(14,2) NOT NULL DEFAULT 0,
      posted_by    INT UNSIGNED NULL,
      posted_at    DATETIME NULL,
      created_by   INT UNSIGNED NULL,
      created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_entry_no (company_id, entry_no),
      INDEX idx_je_status (company_id, status)
    ) ENGINE=InnoDB
  `);
  await conn.query(`
    CREATE TABLE IF NOT EXISTS journal_lines (
      line_id     INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      entry_id    INT UNSIGNED NOT NULL,
      account_id  INT UNSIGNED NOT NULL,
      description VARCHAR(255) NULL,
      debit       DECIMAL(14,2) NOT NULL DEFAULT 0,
      credit      DECIMAL(14,2) NOT NULL DEFAULT 0,
      FOREIGN KEY (entry_id) REFERENCES journal_entries(entry_id) ON DELETE CASCADE,
      FOREIGN KEY (account_id) REFERENCES chart_of_accounts(account_id)
    ) ENGINE=InnoDB
  `);

  /* ---------------------------------------------------------------- */
  /* BIR / EIS register — Philippine tax compliance documents         */
  /* ---------------------------------------------------------------- */
  await conn.query(`
    CREATE TABLE IF NOT EXISTS bir_records (
      record_id    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      company_id   INT UNSIGNED NOT NULL,
      doc_type     ENUM('official_receipt','sales_invoice','form_2307','form_2306','sales_book','purchase_book') NOT NULL,
      doc_no       VARCHAR(60) NOT NULL,
      doc_date     DATE NOT NULL,
      party_name   VARCHAR(160) NULL,
      tin          VARCHAR(30) NULL,
      gross_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
      tax_amount   DECIMAL(14,2) NOT NULL DEFAULT 0,
      description  VARCHAR(255) NULL,
      status       ENUM('active','filed','cancelled') NOT NULL DEFAULT 'active',
      filed_at     DATETIME NULL,
      created_by   INT UNSIGNED NULL,
      created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_bir_company_date (company_id, doc_date),
      INDEX idx_bir_type (company_id, doc_type)
    ) ENGINE=InnoDB
  `);

  /* ---------------------------------------------------------------- */
  /* Light demo seed (company 1) so screens + reports aren't empty    */
  /* ---------------------------------------------------------------- */
  const [[{ n: te }]] = await conn.query("SELECT COUNT(*) n FROM trip_expenses WHERE company_id = 1");
  if (te === 0) {
    const [[branch]] = await conn.query("SELECT branch_id FROM branches WHERE company_id = 1 ORDER BY branch_id LIMIT 1");
    const [trips] = await conn.query("SELECT trip_ticket_id FROM trip_tickets WHERE company_id = 1 ORDER BY trip_ticket_id LIMIT 4");
    const b = branch?.branch_id || 1;
    const t = (i) => trips[i]?.trip_ticket_id || null;
    await conn.query(
      `INSERT INTO trip_expenses (company_id, branch_id, trip_ticket_id, category, description, amount, expense_date, receipt_no) VALUES
        (1, ?, ?, 'fuel',    'Diesel top-up', 4200.00, CURDATE() - INTERVAL 12 DAY, 'OR-10231'),
        (1, ?, ?, 'toll',    'NLEX + SCTEX',   860.00, CURDATE() - INTERVAL 12 DAY, 'OR-10232'),
        (1, ?, ?, 'meals',   'Driver + helper meals', 540.00, CURDATE() - INTERVAL 9 DAY, 'OR-10240'),
        (1, ?, ?, 'fuel',    'Diesel top-up', 3980.00, CURDATE() - INTERVAL 6 DAY, 'OR-10255'),
        (1, ?, ?, 'parking', 'Port terminal parking', 320.00, CURDATE() - INTERVAL 6 DAY, 'OR-10256'),
        (1, ?, ?, 'repair',  'Tire vulcanizing', 750.00, CURDATE() - INTERVAL 3 DAY, 'OR-10270')`,
      [b, t(0), b, t(0), b, t(1), b, t(2), b, t(2), b, t(3)]
    );

    await conn.query(
      `INSERT INTO expense_vouchers (company_id, branch_id, voucher_no, payee, purpose, total_amount, status, submitted_at, approved_at)
       VALUES (1, ?, 'EV-2026-0001', 'Juan Dela Cruz (Driver)', 'Trip cost reimbursement — week 1', 5060.00, 'approved', NOW() - INTERVAL 8 DAY, NOW() - INTERVAL 7 DAY)`,
      [b]
    );
    const [[v]] = await conn.query("SELECT voucher_id FROM expense_vouchers WHERE company_id = 1 LIMIT 1");
    await conn.query(
      `INSERT INTO expense_voucher_lines (voucher_id, description, amount) VALUES
        (?, 'Diesel top-up (OR-10231)', 4200.00),
        (?, 'NLEX + SCTEX toll (OR-10232)', 860.00)`,
      [v.voucher_id, v.voucher_id]
    );

    const [[cust]] = await conn.query("SELECT customer_id FROM customers WHERE company_id = 1 ORDER BY customer_id LIMIT 1");
    if (cust) {
      await conn.query(
        `INSERT INTO invoices (company_id, branch_id, invoice_no, customer_id, invoice_date, due_date, subtotal, tax_amount, total, amount_paid, status)
         VALUES (1, ?, 'INV-2026-0001', ?, CURDATE() - INTERVAL 10 DAY, CURDATE() + INTERVAL 20 DAY, 25000.00, 3000.00, 28000.00, 0.00, 'sent')`,
        [b, cust.customer_id]
      );
      const [[inv]] = await conn.query("SELECT invoice_id FROM invoices WHERE company_id = 1 LIMIT 1");
      await conn.query(
        `INSERT INTO invoice_lines (invoice_id, description, quantity, unit_price, amount) VALUES
          (?, 'Freight — Manila to Cebu (2 trips)', 2, 12500.00, 25000.00)`,
        [inv.invoice_id]
      );
    }

    const [accs] = await conn.query(
      "SELECT account_id, account_code FROM chart_of_accounts WHERE company_id = 1 AND account_code IN ('5000','1000')"
    );
    const fuelAcc = accs.find((a) => a.account_code === "5000")?.account_id;
    const cashAcc = accs.find((a) => a.account_code === "1000")?.account_id;
    if (fuelAcc && cashAcc) {
      await conn.query(
        `INSERT INTO journal_entries (company_id, branch_id, entry_no, entry_date, memo, status, total_debit, total_credit, posted_at)
         VALUES (1, ?, 'JE-2026-0001', CURDATE() - INTERVAL 7 DAY, 'Record week 1 fuel expense', 'posted', 8180.00, 8180.00, NOW() - INTERVAL 7 DAY)`,
        [b]
      );
      const [[je]] = await conn.query("SELECT entry_id FROM journal_entries WHERE company_id = 1 LIMIT 1");
      await conn.query(
        `INSERT INTO journal_lines (entry_id, account_id, description, debit, credit) VALUES
          (?, ?, 'Fuel expense', 8180.00, 0),
          (?, ?, 'Cash paid out', 0, 8180.00)`,
        [je.entry_id, fuelAcc, je.entry_id, cashAcc]
      );
    }

    await conn.query(
      `INSERT INTO bir_records (company_id, doc_type, doc_no, doc_date, party_name, tin, gross_amount, tax_amount, description, status) VALUES
        (1, 'official_receipt', 'OR-2026-0001', CURDATE() - INTERVAL 10 DAY, 'Acme Retail Inc.', '123-456-789-000', 28000.00, 3000.00, 'Freight billing — INV-2026-0001', 'active'),
        (1, 'form_2307', '2307-2026-0001', CURDATE() - INTERVAL 5 DAY, 'Acme Retail Inc.', '123-456-789-000', 25000.00, 500.00, 'Creditable withholding tax 2%', 'active')`
    );
  }
}
