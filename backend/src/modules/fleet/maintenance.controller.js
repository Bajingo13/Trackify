import db from "../../config/db.js";
import { recordAudit } from "../../shared/audit.js";

const NUM = (v) => (v === "" || v == null ? null : Number(v));
const STR = (v) => (v === "" || v == null ? null : String(v).trim());

const SELECT_COLS = `
  m.maintenance_id, m.company_id, m.vehicle_id,
  v.plate_no, v.vehicle_type,
  m.maintenance_type, m.description, m.scheduled_date, m.completed_date,
  m.odometer_reading, m.cost, m.vendor, m.notes, m.status,
  m.created_at, m.updated_at`;

export async function listMaintenance(req, res) {
  const { companyId } = req.context;
  const { vehicleId = "", status = "", search = "" } = req.query;

  const params = [companyId];
  let where = "m.company_id = ?";
  if (NUM(vehicleId)) {
    where += " AND m.vehicle_id = ?";
    params.push(NUM(vehicleId));
  }
  if (["scheduled", "in_progress", "completed", "cancelled"].includes(status)) {
    where += " AND m.status = ?";
    params.push(status);
  }
  if (search.trim()) {
    where += " AND (v.plate_no LIKE ? OR m.maintenance_type LIKE ? OR m.vendor LIKE ?)";
    const s = `%${search.trim()}%`;
    params.push(s, s, s);
  }

  const [rows] = await db.execute(
    `SELECT ${SELECT_COLS}
     FROM vehicle_maintenance m
     JOIN vehicles v ON v.vehicle_id = m.vehicle_id
     WHERE ${where}
     ORDER BY COALESCE(m.completed_date, m.scheduled_date) DESC, m.maintenance_id DESC`,
    params
  );
  res.json({ success: true, data: rows });
}

export async function maintenanceStats(req, res) {
  const { companyId } = req.context;
  const [rows] = await db.execute(
    `SELECT status, COUNT(*) n FROM vehicle_maintenance WHERE company_id = ? GROUP BY status`,
    [companyId]
  );
  const by = Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
  const [[due]] = await db.execute(
    `SELECT COUNT(*) n FROM vehicle_maintenance
     WHERE company_id = ? AND status = 'scheduled' AND scheduled_date <= (CURRENT_DATE + INTERVAL 7 DAY)`,
    [companyId]
  );
  res.json({
    success: true,
    data: {
      total: rows.reduce((a, r) => a + Number(r.n), 0),
      scheduled: by.scheduled || 0,
      inProgress: by.in_progress || 0,
      completed: by.completed || 0,
      dueSoon: Number(due.n),
    },
  });
}

/** Validate + normalize a `parts` payload against the item catalog. */
async function resolveParts(companyId, parts) {
  const clean = (Array.isArray(parts) ? parts : [])
    .map((p) => ({ sku: STR(p.itemId ?? p.sku), qty: NUM(p.quantity) }))
    .filter((p) => p.sku && p.qty > 0);
  if (!clean.length) return [];
  const out = [];
  for (const p of clean) {
    const [[item]] = await db.execute(
      "SELECT item_id, name, unit FROM inventory_items WHERE company_id = ? AND sku = ? AND status = 'active' LIMIT 1",
      [companyId, p.sku]
    );
    if (!item) throw Object.assign(new Error(`Unknown part "${p.sku}".`), { status: 400 });
    out.push({ itemId: item.item_id, sku: p.sku, name: item.name, unit: item.unit, quantity: p.qty });
  }
  return out;
}

async function loadParts(maintenanceId) {
  const [rows] = await db.execute(
    `SELECT mp.maintenance_part_id, mp.item_id, mp.quantity, mp.consumed, i.sku, i.name, i.unit
       FROM maintenance_parts mp JOIN inventory_items i ON i.item_id = mp.item_id
      WHERE mp.maintenance_id = ? ORDER BY mp.maintenance_part_id`,
    [maintenanceId]
  );
  return rows.map((r) => ({
    id: r.maintenance_part_id, itemId: r.sku, name: r.name, unit: r.unit,
    quantity: Number(r.quantity), consumed: !!r.consumed,
  }));
}

export async function getMaintenance(req, res) {
  const { companyId } = req.context;
  const id = Number(req.params.id);
  const [rows] = await db.execute(
    `SELECT ${SELECT_COLS} FROM vehicle_maintenance m JOIN vehicles v ON v.vehicle_id = m.vehicle_id
      WHERE m.maintenance_id = ? AND m.company_id = ? LIMIT 1`,
    [id, companyId]
  );
  if (!rows.length) return res.status(404).json({ success: false, message: "Maintenance record not found." });
  res.json({ success: true, data: { ...rows[0], parts: await loadParts(id) } });
}

export async function createMaintenance(req, res) {
  const { companyId } = req.context;
  const b = req.body;
  const vehicleId = NUM(b.vehicleId);
  const maintenanceType = STR(b.maintenanceType);

  if (!vehicleId || !maintenanceType) {
    return res.status(400).json({ success: false, message: "Vehicle and maintenance type are required." });
  }

  const [veh] = await db.execute(
    "SELECT vehicle_id FROM vehicles WHERE vehicle_id = ? AND company_id = ? LIMIT 1",
    [vehicleId, companyId]
  );
  if (!veh.length) {
    return res.status(400).json({ success: false, message: "Invalid vehicle." });
  }

  let parts;
  try {
    parts = await resolveParts(companyId, b.parts);
  } catch (e) {
    return res.status(e.status || 400).json({ success: false, message: e.message });
  }

  const [result] = await db.execute(
    `INSERT INTO vehicle_maintenance
       (company_id, vehicle_id, maintenance_type, description, scheduled_date,
        odometer_reading, cost, vendor, notes, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      companyId, vehicleId, maintenanceType, STR(b.description), STR(b.scheduledDate),
      NUM(b.odometerReading), NUM(b.cost), STR(b.vendor), STR(b.notes),
      ["scheduled", "in_progress"].includes(b.status) ? b.status : "scheduled",
      req.context.userId,
    ]
  );

  for (const p of parts) {
    await db.execute(
      "INSERT INTO maintenance_parts (maintenance_id, item_id, quantity) VALUES (?, ?, ?)",
      [result.insertId, p.itemId, p.quantity]
    );
  }

  await recordAudit(req, {
    module: "fleet", action: "maintenance.create", entityType: "vehicle_maintenance", entityId: result.insertId,
    summary: `Scheduled ${maintenanceType} for vehicle #${vehicleId}${parts.length ? ` — ${parts.length} part(s) planned` : ""}`,
  });

  res.status(201).json({ success: true, data: { maintenanceId: result.insertId } });
}

export async function updateMaintenance(req, res) {
  const { companyId } = req.context;
  const id = Number(req.params.id);

  const [existing] = await db.execute(
    `SELECT m.maintenance_id, m.vehicle_id, m.odometer_reading, m.status, v.home_branch_id
       FROM vehicle_maintenance m JOIN vehicles v ON v.vehicle_id = m.vehicle_id
      WHERE m.maintenance_id = ? AND m.company_id = ? LIMIT 1`,
    [id, companyId]
  );
  if (!existing.length) {
    return res.status(404).json({ success: false, message: "Maintenance record not found." });
  }
  const record = existing[0];

  // Replace the planned parts list — only while the job hasn't consumed stock yet.
  if (Array.isArray(req.body.parts)) {
    if (record.status === "completed") {
      return res.status(409).json({ success: false, message: "This job is already completed — parts have been consumed and can't be changed." });
    }
    let parts;
    try {
      parts = await resolveParts(companyId, req.body.parts);
    } catch (e) {
      return res.status(e.status || 400).json({ success: false, message: e.message });
    }
    await db.execute("DELETE FROM maintenance_parts WHERE maintenance_id = ?", [id]);
    for (const p of parts) {
      await db.execute(
        "INSERT INTO maintenance_parts (maintenance_id, item_id, quantity) VALUES (?, ?, ?)",
        [id, p.itemId, p.quantity]
      );
    }
  }

  const map = {
    maintenanceType: "maintenance_type", description: "description", scheduledDate: "scheduled_date",
    completedDate: "completed_date", odometerReading: "odometer_reading", cost: "cost",
    vendor: "vendor", notes: "notes",
  };
  const fields = [];
  const params = [];
  for (const [key, col] of Object.entries(map)) {
    if (req.body[key] !== undefined) {
      fields.push(`${col} = ?`);
      params.push(["odometerReading", "cost"].includes(key) ? NUM(req.body[key]) : STR(req.body[key]));
    }
  }
  if (["scheduled", "in_progress", "completed", "cancelled"].includes(req.body.status)) {
    fields.push("status = ?");
    params.push(req.body.status);
    if (req.body.status === "completed" && req.body.completedDate === undefined) {
      fields.push("completed_date = COALESCE(completed_date, CURRENT_DATE)");
    }
  }
  const completingNow = req.body.status === "completed" && record.status !== "completed";

  if (!fields.length && !completingNow) {
    return res.status(400).json({ success: false, message: "Nothing to update." });
  }

  if (fields.length) {
    params.push(id);
    await db.execute(`UPDATE vehicle_maintenance SET ${fields.join(", ")} WHERE maintenance_id = ?`, params);
  }

  let partsConsumedSummary = "";
  if (completingNow) {
    const [pending] = await db.execute(
      `SELECT mp.maintenance_part_id, mp.item_id, mp.quantity, i.sku, i.name
         FROM maintenance_parts mp JOIN inventory_items i ON i.item_id = mp.item_id
        WHERE mp.maintenance_id = ? AND mp.consumed = 0`,
      [id]
    );

    if (pending.length) {
      if (!record.home_branch_id) {
        return res.status(409).json({ success: false, message: "This vehicle has no home branch set, so its maintenance parts can't be deducted from stock." });
      }
      const conn = await db.getConnection();
      try {
        await conn.beginTransaction();
        for (const p of pending) {
          const [[stock]] = await conn.execute(
            "SELECT stock_id, quantity FROM inventory_stock WHERE company_id = ? AND item_id = ? AND location_type = 'branch' AND location_id = ? FOR UPDATE",
            [companyId, p.item_id, record.home_branch_id]
          );
          if (!stock || Number(stock.quantity) < Number(p.quantity)) {
            await conn.rollback();
            return res.status(409).json({
              success: false,
              message: `Not enough ${p.name} (${p.sku}) at this vehicle's branch to complete the job (${stock?.quantity ?? 0} on hand, ${p.quantity} needed).`,
            });
          }
          await conn.execute("UPDATE inventory_stock SET quantity = quantity - ? WHERE stock_id = ?", [p.quantity, stock.stock_id]);
          await conn.execute("UPDATE maintenance_parts SET consumed = 1 WHERE maintenance_part_id = ?", [p.maintenance_part_id]);

          const [[{ next }]] = await conn.execute(
            "SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(reference_no, '-', -1) AS UNSIGNED)), 0) + 1 AS next FROM stock_movements WHERE company_id = ? AND reference_no LIKE ?",
            [companyId, `SMT-${new Date().getFullYear()}-%`]
          );
          const reference = `SMT-${new Date().getFullYear()}-${String(next).padStart(3, "0")}`;
          await conn.execute(
            `INSERT INTO stock_movements
               (company_id, reference_no, item_id, quantity, movement_type,
                source_location_type, source_location_id, status, reason, requested_by)
             VALUES (?, ?, ?, ?, 'Issue', 'branch', ?, 'completed', ?, ?)`,
            [companyId, reference, p.item_id, p.quantity, record.home_branch_id, `Maintenance #${id}`, req.context.userId]
          );
        }
        await conn.commit();
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
      partsConsumedSummary = ` — ${pending.length} part(s) consumed from stock`;
    }
  }

  // When a job completes: roll the vehicle odometer forward to the service
  // reading, and reset the service counter (next service = now + interval).
  if (req.body.status === "completed") {
    const reading = NUM(req.body.odometerReading) || Number(record.odometer_reading) || 0;
    if (reading > 0) {
      await db.execute(
        "UPDATE vehicles SET odometer = GREATEST(odometer, ?) WHERE vehicle_id = ?",
        [reading, record.vehicle_id]
      );
    }
    await db.execute(
      "UPDATE vehicles SET last_service_odometer = odometer WHERE vehicle_id = ?",
      [record.vehicle_id]
    );
  }

  await recordAudit(req, {
    module: "fleet", action: "maintenance.update", entityType: "vehicle_maintenance", entityId: id,
    summary: `Updated maintenance #${id}${partsConsumedSummary}`, metadata: req.body,
  });

  res.json({ success: true, message: completingNow ? `Maintenance completed${partsConsumedSummary}.` : "Updated." });
}
