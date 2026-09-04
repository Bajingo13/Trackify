/**
 * 008 — Branch transfers (inter-branch stock movement with receiving)
 *
 * transfer flow: draft → approved → in_transit (source dispatched, stock deducted)
 *                → completed (destination received, stock added) | cancelled
 * Idempotent.
 */
export async function up(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS branch_transfers (
      transfer_id        INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      company_id         INT UNSIGNED NOT NULL,
      transfer_no        VARCHAR(40) NOT NULL,
      source_branch_id   INT UNSIGNED NOT NULL,
      dest_branch_id     INT UNSIGNED NOT NULL,
      status             ENUM('draft','approved','in_transit','completed','cancelled') NOT NULL DEFAULT 'draft',
      notes              VARCHAR(255) NULL,
      requested_by       INT UNSIGNED NULL,
      approved_by        INT UNSIGNED NULL,
      dispatched_at      DATETIME NULL,
      received_at        DATETIME NULL,
      created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_bt_no (company_id, transfer_no),
      FOREIGN KEY (company_id) REFERENCES companies(company_id),
      FOREIGN KEY (source_branch_id) REFERENCES branches(branch_id),
      FOREIGN KEY (dest_branch_id) REFERENCES branches(branch_id)
    ) ENGINE=InnoDB
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS branch_transfer_items (
      id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      transfer_id   INT UNSIGNED NOT NULL,
      item_id       INT UNSIGNED NOT NULL,
      expected_qty  INT NOT NULL,
      received_qty  INT NULL,
      status        ENUM('pending','confirmed','discrepancy') NOT NULL DEFAULT 'pending',
      FOREIGN KEY (transfer_id) REFERENCES branch_transfers(transfer_id) ON DELETE CASCADE,
      FOREIGN KEY (item_id) REFERENCES inventory_items(item_id)
    ) ENGINE=InnoDB
  `);

  const [[{ n }]] = await conn.query("SELECT COUNT(*) n FROM branch_transfers WHERE company_id = 1");
  if (n === 0) {
    const [brs] = await conn.query("SELECT branch_id, branch_code FROM branches WHERE company_id = 1");
    const b = Object.fromEntries(brs.map((r) => [r.branch_code, r.branch_id]));
    const [items] = await conn.query("SELECT item_id, sku FROM inventory_items WHERE company_id = 1");
    const it = Object.fromEntries(items.map((r) => [r.sku, r.item_id]));

    // give the destination branches some stock to make later receiving realistic
    for (const [sku, code, qty] of [["ITEM-001", "CEB", 12], ["ITEM-002", "GEN", 6]]) {
      if (it[sku] && b[code]) {
        await conn.query(
          "INSERT IGNORE INTO inventory_stock (company_id, item_id, location_type, location_id, quantity) VALUES (1, ?, 'branch', ?, ?)",
          [it[sku], b[code], qty]
        );
      }
    }

    const t1 = await conn.query(
      "INSERT INTO branch_transfers (company_id, transfer_no, source_branch_id, dest_branch_id, status, notes) VALUES (1,'BT-2026-001',?,?,'completed','Regular branch supply transfer')",
      [b.DVO, b.CEB]
    );
    await conn.query(
      "INSERT INTO branch_transfer_items (transfer_id, item_id, expected_qty, received_qty, status) VALUES (?,?,?,?,'confirmed'), (?,?,?,?,'confirmed')",
      [t1[0].insertId, it["ITEM-001"], 20, 20, t1[0].insertId, it["ITEM-004"], 30, 30]
    );

    const t2 = await conn.query(
      "INSERT INTO branch_transfers (company_id, transfer_no, source_branch_id, dest_branch_id, status, notes, dispatched_at) VALUES (1,'BT-2026-002',?,?,'in_transit','In transit to Davao', NOW())",
      [b.CEB, b.DVO]
    );
    await conn.query(
      "INSERT INTO branch_transfer_items (transfer_id, item_id, expected_qty) VALUES (?,?,?), (?,?,?)",
      [t2[0].insertId, it["ITEM-003"], 5, t2[0].insertId, it["ITEM-005"], 8]
    );

    const t3 = await conn.query(
      "INSERT INTO branch_transfers (company_id, transfer_no, source_branch_id, dest_branch_id, status) VALUES (1,'BT-2026-003',?,?,'draft')",
      [b.GEN, b.DVO]
    );
    await conn.query(
      "INSERT INTO branch_transfer_items (transfer_id, item_id, expected_qty) VALUES (?,?,?)",
      [t3[0].insertId, it["ITEM-007"], 10]
    );
  }
}
