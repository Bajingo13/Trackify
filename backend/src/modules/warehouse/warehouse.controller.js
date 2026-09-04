import db from "../../config/db.js";
import { recordAudit } from "../../shared/audit.js";

const NUM = (v) => (v === "" || v == null ? null : Number(v));
const STR = (v) => (v === "" || v == null ? null : String(v).trim());

const stockStatus = (qty, reorder) =>
  qty <= 0 ? "Out of Stock" : qty <= reorder ? "Low Stock" : "In Stock";

/* ---------- locations (warehouses + branches) ---------- */
export async function listLocations(req, res) {
  const { companyId } = req.context;
  const [whs] = await db.execute(
    "SELECT warehouse_id AS id, code, name, location FROM warehouses WHERE company_id = ? AND status = 'active' ORDER BY name",
    [companyId]
  );
  const [brs] = await db.execute(
    "SELECT branch_id AS id, branch_code AS code, branch_name AS name FROM branches WHERE company_id = ? ORDER BY branch_name",
    [companyId]
  );
  res.json({
    success: true,
    data: [
      ...whs.map((w) => ({ ...w, locationType: "warehouse" })),
      ...brs.map((b) => ({ ...b, location: null, locationType: "branch" })),
    ],
  });
}

/* ---------- item catalog ---------- */
export async function listItems(req, res) {
  const { companyId } = req.context;
  const [rows] = await db.execute(
    `SELECT i.item_id, i.sku, i.name, i.category, i.unit, i.unit_cost, i.reorder_level, i.status,
            COALESCE(SUM(s.quantity), 0) AS total_qty
     FROM inventory_items i
     LEFT JOIN inventory_stock s ON s.item_id = i.item_id
     WHERE i.company_id = ?
     GROUP BY i.item_id
     ORDER BY i.name`,
    [companyId]
  );
  res.json({
    success: true,
    data: rows.map((r) => ({
      id: r.item_id, itemId: r.sku, name: r.name, category: r.category,
      unit: r.unit, unitCost: Number(r.unit_cost), reorderLevel: Number(r.reorder_level),
      status: r.status, totalQuantity: Number(r.total_qty),
    })),
  });
}

export async function createItem(req, res) {
  const { companyId } = req.context;
  const b = req.body;
  const sku = STR(b.sku);
  const name = STR(b.name);
  if (!sku || !name) {
    return res.status(400).json({ success: false, message: "SKU and name are required." });
  }

  const [[dupe]] = await db.execute(
    "SELECT item_id FROM inventory_items WHERE company_id = ? AND sku = ? LIMIT 1",
    [companyId, sku]
  );
  if (dupe) return res.status(409).json({ success: false, message: `An item with SKU "${sku}" already exists.` });

  const initType = STR(b.initialLocationType);
  const initId = NUM(b.initialLocationId);
  const initQty = NUM(b.initialQuantity) || 0;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [ins] = await conn.execute(
      `INSERT INTO inventory_items (company_id, sku, name, category, unit, unit_cost, reorder_level)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [companyId, sku, name, STR(b.category) || "Consumables", STR(b.unit) || "Pieces", NUM(b.unitCost) || 0, NUM(b.reorderLevel) || 0]
    );
    if (initType && initId && initQty > 0) {
      await conn.execute(
        "INSERT INTO inventory_stock (company_id, item_id, location_type, location_id, quantity) VALUES (?, ?, ?, ?, ?)",
        [companyId, ins.insertId, initType, initId, initQty]
      );
    }
    await conn.commit();
    await recordAudit(req, {
      module: "warehouse", action: "item.create", entityType: "inventory_item", entityId: ins.insertId,
      summary: `Created item ${sku} — ${name}`,
    });
    res.status(201).json({ success: true, message: "Item created.", data: { itemId: ins.insertId } });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function updateItem(req, res) {
  const { companyId } = req.context;
  const id = Number(req.params.id);
  const [[existing]] = await db.execute(
    "SELECT item_id FROM inventory_items WHERE item_id = ? AND company_id = ? LIMIT 1",
    [id, companyId]
  );
  if (!existing) return res.status(404).json({ success: false, message: "Item not found." });

  const map = { name: "name", category: "category", unit: "unit", unitCost: "unit_cost", reorderLevel: "reorder_level" };
  const fields = [];
  const params = [];
  for (const [key, col] of Object.entries(map)) {
    if (req.body[key] !== undefined) {
      fields.push(`${col} = ?`);
      params.push(["unitCost", "reorderLevel"].includes(key) ? NUM(req.body[key]) : STR(req.body[key]));
    }
  }
  if (req.body.status === "active" || req.body.status === "inactive") {
    fields.push("status = ?");
    params.push(req.body.status);
  }
  if (!fields.length) return res.status(400).json({ success: false, message: "Nothing to update." });

  params.push(id);
  await db.execute(`UPDATE inventory_items SET ${fields.join(", ")} WHERE item_id = ?`, params);
  await recordAudit(req, {
    module: "warehouse", action: "item.update", entityType: "inventory_item", entityId: id,
    summary: `Updated item #${id}`, metadata: req.body,
  });
  res.json({ success: true });
}

/* ---------- inventory ---------- */
async function nameFor(companyId, type, id) {
  if (!type || !id) return null;
  if (type === "warehouse") {
    const [r] = await db.execute("SELECT name FROM warehouses WHERE warehouse_id = ? AND company_id = ?", [id, companyId]);
    return r[0]?.name || null;
  }
  const [r] = await db.execute("SELECT branch_name FROM branches WHERE branch_id = ? AND company_id = ?", [id, companyId]);
  return r[0]?.branch_name || null;
}

export async function listInventory(req, res) {
  const { companyId } = req.context;
  const [rows] = await db.execute(
    `SELECT s.stock_id, s.item_id, s.location_type, s.location_id, s.quantity, s.updated_at,
            i.sku, i.name, i.category, i.unit, i.unit_cost, i.reorder_level,
            CASE s.location_type WHEN 'warehouse' THEN w.name ELSE b.branch_name END AS location_name
     FROM inventory_stock s
     JOIN inventory_items i ON i.item_id = s.item_id
     LEFT JOIN warehouses w ON s.location_type = 'warehouse' AND w.warehouse_id = s.location_id
     LEFT JOIN branches   b ON s.location_type = 'branch'    AND b.branch_id    = s.location_id
     WHERE s.company_id = ? AND i.status = 'active'
     ORDER BY i.name, location_name`,
    [companyId]
  );
  res.json({
    success: true,
    data: rows.map((r) => ({
      id: r.stock_id,
      itemId: r.sku,
      name: r.name,
      category: r.category,
      locationType: r.location_type,
      locationId: r.location_id,
      locationName: r.location_name,
      quantity: Number(r.quantity),
      unit: r.unit,
      reorderLevel: Number(r.reorder_level),
      unitCost: Number(r.unit_cost),
      status: stockStatus(Number(r.quantity), Number(r.reorder_level)),
      lastUpdated: r.updated_at,
    })),
  });
}

/** Items at or below their reorder level, worst first — for the dashboard alert
 *  and the Inventory page's "needs attention" filter. */
export async function lowStock(req, res) {
  const { companyId } = req.context;
  const [rows] = await db.execute(
    `SELECT s.stock_id, s.location_type, s.location_id, s.quantity,
            i.sku, i.name, i.unit, i.reorder_level,
            CASE s.location_type WHEN 'warehouse' THEN w.name ELSE b.branch_name END AS location_name
     FROM inventory_stock s
     JOIN inventory_items i ON i.item_id = s.item_id
     LEFT JOIN warehouses w ON s.location_type = 'warehouse' AND w.warehouse_id = s.location_id
     LEFT JOIN branches   b ON s.location_type = 'branch'    AND b.branch_id    = s.location_id
     WHERE s.company_id = ? AND i.status = 'active'
       AND s.quantity <= i.reorder_level
     ORDER BY (s.quantity <= 0) DESC, (i.reorder_level - s.quantity) DESC
     LIMIT 50`,
    [companyId]
  );
  res.json({
    success: true,
    data: rows.map((r) => ({
      stockId: r.stock_id,
      itemId: r.sku,
      name: r.name,
      unit: r.unit,
      locationType: r.location_type,
      locationName: r.location_name,
      quantity: Number(r.quantity),
      reorderLevel: Number(r.reorder_level),
      severity: Number(r.quantity) <= 0 ? "critical" : "warning",
    })),
  });
}

export async function inventoryStats(req, res) {
  const { companyId } = req.context;
  const [[row]] = await db.execute(
    `SELECT
       COUNT(*) AS total,
       COALESCE(SUM(s.quantity * i.unit_cost), 0) AS total_value,
       SUM(CASE WHEN s.quantity > 0 AND s.quantity <= i.reorder_level THEN 1 ELSE 0 END) AS low_stock,
       SUM(CASE WHEN s.quantity <= 0 THEN 1 ELSE 0 END) AS out_of_stock
     FROM inventory_stock s
     JOIN inventory_items i ON i.item_id = s.item_id
     WHERE s.company_id = ? AND i.status = 'active'`,
    [companyId]
  );
  res.json({
    success: true,
    data: {
      total: Number(row.total),
      totalValue: Number(row.total_value),
      lowStock: Number(row.low_stock),
      outOfStock: Number(row.out_of_stock),
    },
  });
}

/* ---------- stock movements ---------- */
export async function listMovements(req, res) {
  const { companyId } = req.context;
  const [rows] = await db.execute(
    `SELECT m.*, i.sku, i.name AS item_name
     FROM stock_movements m
     JOIN inventory_items i ON i.item_id = m.item_id
     WHERE m.company_id = ?
     ORDER BY m.created_at DESC, m.movement_id DESC`,
    [companyId]
  );

  // resolve location names (small result set)
  const data = [];
  for (const r of rows) {
    data.push({
      id: r.movement_id,
      referenceNo: r.reference_no,
      itemId: r.sku,
      itemName: r.item_name,
      quantity: Number(r.quantity),
      movementType: r.movement_type,
      status: { pending: "Pending", in_transit: "In Transit", completed: "Completed", cancelled: "Cancelled" }[r.status] || r.status,
      reason: r.reason,
      sourceLocationName: await nameFor(companyId, r.source_location_type, r.source_location_id),
      destinationLocationName: await nameFor(companyId, r.dest_location_type, r.dest_location_id),
      date: r.created_at,
    });
  }
  res.json({ success: true, data });
}

export async function movementStats(req, res) {
  const { companyId } = req.context;
  const [rows] = await db.execute(
    "SELECT status, COUNT(*) n FROM stock_movements WHERE company_id = ? GROUP BY status",
    [companyId]
  );
  const by = Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
  res.json({
    success: true,
    data: {
      total: rows.reduce((a, r) => a + Number(r.n), 0),
      completed: by.completed || 0,
      inTransit: by.in_transit || 0,
      pending: by.pending || 0,
    },
  });
}

export async function receiveMovement(req, res) {
  const { companyId } = req.context;
  const id = Number(req.params.id);
  const [[m]] = await db.execute(
    "SELECT status, reference_no FROM stock_movements WHERE movement_id = ? AND company_id = ?",
    [id, companyId]
  );
  if (!m) return res.status(404).json({ success: false, message: "Movement not found." });
  if (m.status !== "in_transit") {
    return res.status(409).json({ success: false, message: "Only an in-transit movement can be marked as received." });
  }
  await db.execute("UPDATE stock_movements SET status = 'completed' WHERE movement_id = ?", [id]);
  await recordAudit(req, {
    module: "warehouse", action: "stock.movement.receive", entityType: "stock_movement", entityId: id,
    summary: `Received ${m.reference_no}`,
  });
  res.json({ success: true, message: "Movement marked as received." });
}

export async function cancelMovement(req, res) {
  const { companyId } = req.context;
  const id = Number(req.params.id);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[m]] = await conn.execute(
      "SELECT * FROM stock_movements WHERE movement_id = ? AND company_id = ? FOR UPDATE",
      [id, companyId]
    );
    if (!m) { await conn.rollback(); return res.status(404).json({ success: false, message: "Movement not found." }); }
    if (!["in_transit", "pending"].includes(m.status)) {
      await conn.rollback();
      return res.status(409).json({ success: false, message: "Only a pending or in-transit movement can be cancelled." });
    }

    const tookFromSource = ["Transfer", "Issue", "Return"].includes(m.movement_type) && m.source_location_type && m.source_location_id;
    const addedToDest = m.dest_location_type && m.dest_location_id;

    if (tookFromSource) {
      const [[s]] = await conn.execute(
        "SELECT stock_id FROM inventory_stock WHERE company_id = ? AND item_id = ? AND location_type = ? AND location_id = ? FOR UPDATE",
        [companyId, m.item_id, m.source_location_type, m.source_location_id]
      );
      if (s) await conn.execute("UPDATE inventory_stock SET quantity = quantity + ? WHERE stock_id = ?", [m.quantity, s.stock_id]);
      else await conn.execute(
        "INSERT INTO inventory_stock (company_id, item_id, location_type, location_id, quantity) VALUES (?, ?, ?, ?, ?)",
        [companyId, m.item_id, m.source_location_type, m.source_location_id, m.quantity]
      );
    }
    if (addedToDest) {
      const [[d]] = await conn.execute(
        "SELECT stock_id FROM inventory_stock WHERE company_id = ? AND item_id = ? AND location_type = ? AND location_id = ? FOR UPDATE",
        [companyId, m.item_id, m.dest_location_type, m.dest_location_id]
      );
      if (d) await conn.execute("UPDATE inventory_stock SET quantity = GREATEST(0, quantity - ?) WHERE stock_id = ?", [m.quantity, d.stock_id]);
    }

    await conn.execute("UPDATE stock_movements SET status = 'cancelled' WHERE movement_id = ?", [id]);
    await conn.commit();
    await recordAudit(req, {
      module: "warehouse", action: "stock.movement.cancel", entityType: "stock_movement", entityId: id,
      summary: `Cancelled ${m.reference_no} (stock reversed)`,
    });
    res.json({ success: true, message: "Movement cancelled — stock reversed." });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function createMovement(req, res) {
  const { companyId, userId } = req.context;
  const b = req.body;
  const sku = STR(b.itemId);
  const quantity = NUM(b.quantity);
  const type = STR(b.movementType);
  const destType = STR(b.destinationLocationType);
  const destId = NUM(b.destinationLocationId);
  const srcType = STR(b.sourceLocationType);
  const srcId = NUM(b.sourceLocationId);

  if (!sku || !quantity || quantity <= 0 || !type) {
    return res.status(400).json({ success: false, message: "Item, a positive quantity and a movement type are required." });
  }
  if (!["Transfer", "Issue", "Receiving", "Adjustment", "Return"].includes(type)) {
    return res.status(400).json({ success: false, message: "Unknown movement type." });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[item]] = await conn.execute(
      "SELECT item_id FROM inventory_items WHERE company_id = ? AND sku = ? AND status = 'active' LIMIT 1",
      [companyId, sku]
    );
    if (!item) {
      await conn.rollback();
      return res.status(400).json({ success: false, message: "Unknown item." });
    }
    const itemId = item.item_id;

    const takesFromSource = ["Transfer", "Issue", "Return"].includes(type);
    const addsToDest = ["Transfer", "Receiving", "Adjustment"].includes(type) && destType && destId;

    if (takesFromSource) {
      if (!srcType || !srcId) {
        await conn.rollback();
        return res.status(400).json({ success: false, message: "A source location is required for this movement." });
      }
      const [[src]] = await conn.execute(
        "SELECT stock_id, quantity FROM inventory_stock WHERE company_id = ? AND item_id = ? AND location_type = ? AND location_id = ? FOR UPDATE",
        [companyId, itemId, srcType, srcId]
      );
      if (!src || src.quantity < quantity) {
        await conn.rollback();
        return res.status(409).json({ success: false, message: `Not enough stock at the source (${src?.quantity ?? 0} available).` });
      }
      await conn.execute("UPDATE inventory_stock SET quantity = quantity - ? WHERE stock_id = ?", [quantity, src.stock_id]);
    }

    if (addsToDest) {
      const [[dest]] = await conn.execute(
        "SELECT stock_id FROM inventory_stock WHERE company_id = ? AND item_id = ? AND location_type = ? AND location_id = ? FOR UPDATE",
        [companyId, itemId, destType, destId]
      );
      if (dest) {
        await conn.execute("UPDATE inventory_stock SET quantity = quantity + ? WHERE stock_id = ?", [quantity, dest.stock_id]);
      } else {
        await conn.execute(
          "INSERT INTO inventory_stock (company_id, item_id, location_type, location_id, quantity) VALUES (?, ?, ?, ?, ?)",
          [companyId, itemId, destType, destId, quantity]
        );
      }
    }

    const [[{ next }]] = await conn.execute(
      "SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(reference_no, '-', -1) AS UNSIGNED)), 0) + 1 AS next FROM stock_movements WHERE company_id = ? AND reference_no LIKE ?",
      [companyId, `SMT-${new Date().getFullYear()}-%`]
    );
    const reference = `SMT-${new Date().getFullYear()}-${String(next).padStart(3, "0")}`;
    const status = type === "Transfer" ? "in_transit" : "completed";

    const [ins] = await conn.execute(
      `INSERT INTO stock_movements
        (company_id, reference_no, item_id, quantity, movement_type,
         source_location_type, source_location_id, dest_location_type, dest_location_id, status, reason, requested_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [companyId, reference, itemId, quantity, type,
        takesFromSource ? srcType : null, takesFromSource ? srcId : null,
        addsToDest ? destType : null, addsToDest ? destId : null,
        status, STR(b.reason), userId]
    );

    await conn.commit();
    await recordAudit(req, {
      module: "warehouse", action: "stock.movement", entityType: "stock_movement", entityId: ins.insertId,
      summary: `${type} ${quantity} × ${sku} (${reference})`,
    });
    res.status(201).json({ success: true, message: "Stock movement recorded.", data: { movementId: ins.insertId, referenceNo: reference } });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
