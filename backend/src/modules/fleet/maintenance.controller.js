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

  await recordAudit(req, {
    module: "fleet", action: "maintenance.create", entityType: "vehicle_maintenance", entityId: result.insertId,
    summary: `Scheduled ${maintenanceType} for vehicle #${vehicleId}`,
  });

  res.status(201).json({ success: true, data: { maintenanceId: result.insertId } });
}

export async function updateMaintenance(req, res) {
  const { companyId } = req.context;
  const id = Number(req.params.id);

  const [existing] = await db.execute(
    "SELECT maintenance_id, vehicle_id FROM vehicle_maintenance WHERE maintenance_id = ? AND company_id = ? LIMIT 1",
    [id, companyId]
  );
  if (!existing.length) {
    return res.status(404).json({ success: false, message: "Maintenance record not found." });
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
  if (!fields.length) {
    return res.status(400).json({ success: false, message: "Nothing to update." });
  }

  params.push(id);
  await db.execute(`UPDATE vehicle_maintenance SET ${fields.join(", ")} WHERE maintenance_id = ?`, params);

  // When a job completes with an odometer reading, roll the vehicle forward.
  if (req.body.status === "completed" && NUM(req.body.odometerReading)) {
    await db.execute(
      "UPDATE vehicles SET odometer = GREATEST(odometer, ?) WHERE vehicle_id = ?",
      [NUM(req.body.odometerReading), existing[0].vehicle_id]
    );
  }

  await recordAudit(req, {
    module: "fleet", action: "maintenance.update", entityType: "vehicle_maintenance", entityId: id,
    summary: `Updated maintenance #${id}`, metadata: req.body,
  });

  res.json({ success: true });
}
