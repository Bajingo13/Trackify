import db from "../../config/db.js";
import { recordAudit } from "../../shared/audit.js";

const ACTIVE_TRIP_STATUSES = ["assigned", "accepted", "released", "in_transit"];

/**
 * A vehicle's live operational status = its own status, overlaid with whether
 * it's on an active trip right now.
 */
const OPERATIONAL_STATUS_SQL = `
  CASE
    WHEN v.status = 'maintenance' THEN 'maintenance'
    WHEN v.status = 'inactive' THEN 'inactive'
    WHEN EXISTS (
      SELECT 1 FROM trip_assignments ta
      JOIN trip_tickets tt ON tt.trip_ticket_id = ta.trip_ticket_id
      WHERE ta.vehicle_id = v.vehicle_id AND ta.is_current = TRUE
        AND tt.status IN ('assigned','accepted','released','in_transit')
    ) THEN 'on_trip'
    ELSE 'available'
  END`;

const SELECT_COLS = `
  v.vehicle_id, v.company_id, v.home_branch_id, b.branch_name AS home_branch,
  v.plate_no, v.vehicle_type, v.brand, v.model, v.year, v.color,
  v.capacity, v.odometer, v.registration_expiry, v.insurance_expiry,
  v.status, ${OPERATIONAL_STATUS_SQL} AS operational_status,
  v.created_at, v.updated_at`;

export async function listVehicles(req, res) {
  const { companyId } = req.context;
  const { search = "", status = "", type = "" } = req.query;

  const params = [companyId];
  let where = "v.company_id = ?";

  if (search.trim()) {
    where += " AND (v.plate_no LIKE ? OR v.brand LIKE ? OR v.model LIKE ? OR v.vehicle_type LIKE ?)";
    const s = `%${search.trim()}%`;
    params.push(s, s, s, s);
  }
  if (["active", "inactive", "maintenance"].includes(status)) {
    where += " AND v.status = ?";
    params.push(status);
  }
  if (type.trim()) {
    where += " AND v.vehicle_type = ?";
    params.push(type.trim());
  }

  const [rows] = await db.execute(
    `SELECT ${SELECT_COLS}
     FROM vehicles v
     LEFT JOIN branches b ON b.branch_id = v.home_branch_id
     WHERE ${where}
     ORDER BY v.plate_no ASC`,
    params
  );

  res.json({ success: true, data: rows });
}

export async function getVehicle(req, res) {
  const { companyId } = req.context;
  const id = Number(req.params.id);
  const [rows] = await db.execute(
    `SELECT ${SELECT_COLS}
     FROM vehicles v
     LEFT JOIN branches b ON b.branch_id = v.home_branch_id
     WHERE v.vehicle_id = ? AND v.company_id = ? LIMIT 1`,
    [id, companyId]
  );
  if (!rows.length) {
    return res.status(404).json({ success: false, message: "Vehicle not found." });
  }
  res.json({ success: true, data: rows[0] });
}

export async function vehicleStats(req, res) {
  const { companyId } = req.context;
  const [rows] = await db.execute(
    `SELECT ${OPERATIONAL_STATUS_SQL} AS s, COUNT(*) AS n
     FROM vehicles v WHERE v.company_id = ? GROUP BY s`,
    [companyId]
  );
  const by = Object.fromEntries(rows.map((r) => [r.s, Number(r.n)]));
  res.json({
    success: true,
    data: {
      total: rows.reduce((a, r) => a + Number(r.n), 0),
      available: by.available || 0,
      onTrip: by.on_trip || 0,
      maintenance: by.maintenance || 0,
      inactive: by.inactive || 0,
    },
  });
}

const NUM = (v) => (v === "" || v === undefined || v === null ? null : Number(v));
const STR = (v) => (v === "" || v === undefined || v === null ? null : String(v).trim());

export async function createVehicle(req, res) {
  const { companyId } = req.context;
  const b = req.body;
  const plateNo = STR(b.plateNo)?.toUpperCase();
  const vehicleType = STR(b.vehicleType);

  if (!plateNo || !vehicleType) {
    return res.status(400).json({ success: false, message: "Plate number and vehicle type are required." });
  }

  const [dupe] = await db.execute(
    "SELECT vehicle_id FROM vehicles WHERE company_id = ? AND plate_no = ? LIMIT 1",
    [companyId, plateNo]
  );
  if (dupe.length) {
    return res.status(409).json({ success: false, message: "A vehicle with that plate number already exists." });
  }

  const homeBranchId = NUM(b.homeBranchId) || req.context.branchId;
  const [result] = await db.execute(
    `INSERT INTO vehicles
       (company_id, home_branch_id, plate_no, vehicle_type, brand, model, year, color,
        capacity, odometer, registration_expiry, insurance_expiry, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      companyId, homeBranchId, plateNo, vehicleType,
      STR(b.brand), STR(b.model), NUM(b.year), STR(b.color),
      NUM(b.capacity), NUM(b.odometer) ?? 0, STR(b.registrationExpiry), STR(b.insuranceExpiry),
      ["active", "inactive", "maintenance"].includes(b.status) ? b.status : "active",
    ]
  );

  await recordAudit(req, {
    module: "fleet", action: "vehicle.create", entityType: "vehicle", entityId: result.insertId,
    summary: `Added vehicle ${plateNo} (${vehicleType})`,
  });

  res.status(201).json({ success: true, data: { vehicleId: result.insertId } });
}

const UPDATABLE = {
  vehicleType: "vehicle_type", brand: "brand", model: "model", year: "year", color: "color",
  capacity: "capacity", odometer: "odometer",
  registrationExpiry: "registration_expiry", insuranceExpiry: "insurance_expiry",
  homeBranchId: "home_branch_id",
};

export async function updateVehicle(req, res) {
  const { companyId } = req.context;
  const id = Number(req.params.id);

  const [existing] = await db.execute(
    "SELECT vehicle_id, odometer FROM vehicles WHERE vehicle_id = ? AND company_id = ? LIMIT 1",
    [id, companyId]
  );
  if (!existing.length) {
    return res.status(404).json({ success: false, message: "Vehicle not found." });
  }

  const fields = [];
  const params = [];
  for (const [key, col] of Object.entries(UPDATABLE)) {
    if (req.body[key] !== undefined) {
      const val = ["year", "capacity", "odometer", "homeBranchId"].includes(key)
        ? NUM(req.body[key])
        : STR(req.body[key]);
      fields.push(`${col} = ?`);
      params.push(val);
    }
  }
  if (["active", "inactive", "maintenance"].includes(req.body.status)) {
    fields.push("status = ?");
    params.push(req.body.status);
  }
  if (req.body.odometer !== undefined && NUM(req.body.odometer) < Number(existing[0].odometer)) {
    return res.status(400).json({ success: false, message: "Odometer reading cannot go backwards." });
  }
  if (!fields.length) {
    return res.status(400).json({ success: false, message: "Nothing to update." });
  }

  params.push(id);
  await db.execute(`UPDATE vehicles SET ${fields.join(", ")} WHERE vehicle_id = ?`, params);

  await recordAudit(req, {
    module: "fleet", action: "vehicle.update", entityType: "vehicle", entityId: id,
    summary: `Updated vehicle #${id}`, metadata: req.body,
  });

  res.json({ success: true });
}
