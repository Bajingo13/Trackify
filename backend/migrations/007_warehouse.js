/**
 * 007 — Warehouse module (inventory, stock, movements)
 *
 * Tables + seed data for the Inventory and Stock Movements screens, which were
 * previously frontend mock data. Idempotent — safe to rerun.
 * Warehouse permissions already exist (migration 005).
 */

async function tableExists(conn, name) {
  const [rows] = await conn.query("SHOW TABLES LIKE ?", [name]);
  return rows.length > 0;
}

export async function up(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS warehouses (
      warehouse_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      company_id   INT UNSIGNED NOT NULL,
      code         VARCHAR(20) NOT NULL,
      name         VARCHAR(120) NOT NULL,
      location     VARCHAR(160) NULL,
      status       ENUM('active','inactive') NOT NULL DEFAULT 'active',
      created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_wh_code (company_id, code),
      FOREIGN KEY (company_id) REFERENCES companies(company_id)
    ) ENGINE=InnoDB
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS inventory_items (
      item_id      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      company_id   INT UNSIGNED NOT NULL,
      sku          VARCHAR(40) NOT NULL,
      name         VARCHAR(160) NOT NULL,
      category     VARCHAR(60) NOT NULL DEFAULT 'Consumables',
      unit         VARCHAR(30) NOT NULL DEFAULT 'Pieces',
      unit_cost    DECIMAL(12,2) NOT NULL DEFAULT 0,
      reorder_level INT NOT NULL DEFAULT 0,
      status       ENUM('active','inactive') NOT NULL DEFAULT 'active',
      created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_item_sku (company_id, sku),
      FOREIGN KEY (company_id) REFERENCES companies(company_id)
    ) ENGINE=InnoDB
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS inventory_stock (
      stock_id      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      company_id    INT UNSIGNED NOT NULL,
      item_id       INT UNSIGNED NOT NULL,
      location_type ENUM('warehouse','branch') NOT NULL,
      location_id   INT UNSIGNED NOT NULL,
      quantity      INT NOT NULL DEFAULT 0,
      updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_stock (company_id, item_id, location_type, location_id),
      FOREIGN KEY (item_id) REFERENCES inventory_items(item_id)
    ) ENGINE=InnoDB
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS stock_movements (
      movement_id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      company_id           INT UNSIGNED NOT NULL,
      reference_no         VARCHAR(40) NOT NULL,
      item_id              INT UNSIGNED NOT NULL,
      quantity             INT NOT NULL,
      movement_type        ENUM('Transfer','Issue','Receiving','Adjustment','Return') NOT NULL,
      source_location_type ENUM('warehouse','branch') NULL,
      source_location_id   INT UNSIGNED NULL,
      dest_location_type   ENUM('warehouse','branch') NULL,
      dest_location_id     INT UNSIGNED NULL,
      status               ENUM('pending','in_transit','completed','cancelled') NOT NULL DEFAULT 'completed',
      reason               VARCHAR(255) NULL,
      requested_by         INT UNSIGNED NULL,
      approved_by          INT UNSIGNED NULL,
      created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_move_ref (company_id, reference_no),
      FOREIGN KEY (item_id) REFERENCES inventory_items(item_id)
    ) ENGINE=InnoDB
  `);

  // ---- seed (company 1) ----
  const [[{ n: whCount }]] = await conn.query("SELECT COUNT(*) n FROM warehouses WHERE company_id = 1");
  if (whCount === 0) {
    await conn.query(
      `INSERT INTO warehouses (company_id, code, name, location) VALUES
        (1,'DVO-WH','Davao Distribution Center','Davao City'),
        (1,'CEB-WH','Cebu Warehouse','Cebu City'),
        (1,'GEN-WH','General Santos Depot','General Santos City')`
    );
  }

  const [[{ n: itemCount }]] = await conn.query("SELECT COUNT(*) n FROM inventory_items WHERE company_id = 1");
  if (itemCount === 0) {
    await conn.query(
      `INSERT INTO inventory_items (company_id, sku, name, category, unit, unit_cost, reorder_level) VALUES
        (1,'ITEM-001','Engine Oil 5W-40 (4L)','Consumables','Bottles',1800,30),
        (1,'ITEM-002','Brake Pad Set (Front)','Spare Parts','Sets',2800,10),
        (1,'ITEM-003','NS40Z Battery','Spare Parts','Units',5500,5),
        (1,'ITEM-004','Fuel Filter (Diesel)','Consumables','Pieces',450,20),
        (1,'ITEM-005','Tire 225/70R17.5','Tires','Pieces',12000,4),
        (1,'ITEM-006','Windshield Wiper Blade','Consumables','Pairs',350,5),
        (1,'ITEM-007','Transmission Fluid ATF','Consumables','Gallons',2200,10),
        (1,'ITEM-008','Air Filter Element','Spare Parts','Pieces',650,15),
        (1,'ITEM-009','Coolant Antifreeze (4L)','Consumables','Bottles',950,5),
        (1,'ITEM-010','Grease Cartridge','Consumables','Tubes',280,12)`
    );

    // stock: map by sku -> id, warehouses/branches by code -> id
    const [items] = await conn.query("SELECT item_id, sku FROM inventory_items WHERE company_id = 1");
    const iid = Object.fromEntries(items.map((r) => [r.sku, r.item_id]));
    const [whs] = await conn.query("SELECT warehouse_id, code FROM warehouses WHERE company_id = 1");
    const wid = Object.fromEntries(whs.map((r) => [r.code, r.warehouse_id]));
    const [brs] = await conn.query("SELECT branch_id, branch_code FROM branches WHERE company_id = 1");
    const bid = Object.fromEntries(brs.map((r) => [r.branch_code, r.branch_id]));

    const stock = [
      ["ITEM-001", "warehouse", wid["DVO-WH"], 120],
      ["ITEM-001", "branch", bid["DVO"], 24],
      ["ITEM-002", "warehouse", wid["DVO-WH"], 45],
      ["ITEM-003", "warehouse", wid["CEB-WH"], 18],
      ["ITEM-004", "warehouse", wid["DVO-WH"], 80],
      ["ITEM-005", "warehouse", wid["GEN-WH"], 8],
      ["ITEM-006", "branch", bid["CEB"], 15],
      ["ITEM-007", "warehouse", wid["GEN-WH"], 3],
      ["ITEM-008", "warehouse", wid["DVO-WH"], 60],
      ["ITEM-009", "branch", bid["GEN"], 10],
      ["ITEM-010", "warehouse", wid["CEB-WH"], 40],
    ].filter((r) => r[2]);

    for (const [sku, lt, lid, qty] of stock) {
      await conn.query(
        "INSERT INTO inventory_stock (company_id, item_id, location_type, location_id, quantity) VALUES (1,?,?,?,?)",
        [iid[sku], lt, lid, qty]
      );
    }

    const moves = [
      ["SMT-2026-001", "ITEM-001", 20, "Transfer", "warehouse", wid["DVO-WH"], "branch", bid["DVO"], "completed", null],
      ["SMT-2026-002", "ITEM-001", 5, "Transfer", "warehouse", wid["DVO-WH"], "branch", bid["CEB"], "in_transit", null],
      ["SMT-2026-003", "ITEM-003", 2, "Issue", "warehouse", wid["CEB-WH"], "branch", bid["GEN"], "completed", null],
      ["SMT-2026-004", "ITEM-005", 4, "Receiving", "warehouse", wid["GEN-WH"], "warehouse", wid["GEN-WH"], "completed", null],
      ["SMT-2026-005", "ITEM-007", 7, "Adjustment", "warehouse", wid["GEN-WH"], "warehouse", wid["GEN-WH"], "completed", "Stock correction after physical count"],
    ];
    for (const [ref, sku, qty, type, slt, sli, dlt, dli, st, reason] of moves) {
      await conn.query(
        `INSERT INTO stock_movements
          (company_id, reference_no, item_id, quantity, movement_type,
           source_location_type, source_location_id, dest_location_type, dest_location_id, status, reason)
         VALUES (1,?,?,?,?,?,?,?,?,?,?)`,
        [ref, iid[sku], qty, type, slt, sli, dlt, dli, st, reason]
      );
    }
  }
}
