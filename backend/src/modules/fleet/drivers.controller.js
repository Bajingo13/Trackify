import bcrypt from "bcrypt";
import db from "../../config/db.js";
import { recordAudit } from "../../shared/audit.js";

const OPERATIONAL_STATUS_SQL = `
  CASE
    WHEN d.status = 'inactive' THEN 'inactive'
    WHEN EXISTS (
      SELECT 1 FROM trip_assignments ta
      JOIN trip_tickets tt ON tt.trip_ticket_id = ta.trip_ticket_id
      WHERE ta.driver_id = d.driver_id AND ta.is_current = TRUE
        AND tt.status IN ('assigned','accepted','released','in_transit')
    ) THEN 'on_trip'
    ELSE 'available'
  END`;

const SELECT_COLS = `
  d.driver_id, d.company_id, d.home_branch_id, b.branch_name AS home_branch,
  d.employee_no, d.first_name, d.last_name, d.phone,
  d.license_no, d.license_type, d.license_expiry,
  d.emergency_contact_name, d.emergency_contact_phone, d.emergency_contact_relation,
  d.app_enabled, (d.pin_hash IS NOT NULL) AS has_pin,
  d.status, ${OPERATIONAL_STATUS_SQL} AS operational_status,
  d.created_at, d.updated_at`;

const NUM = (v) => (v === "" || v == null ? null : Number(v));
const STR = (v) => (v === "" || v == null ? null : String(v).trim());

export async function listDrivers(req, res) {
  const { companyId } = req.context;
  const { search = "", status = "", licenseType = "" } = req.query;

  const params = [companyId];
  let where = "d.company_id = ?";

  if (search.trim()) {
    where += " AND (d.first_name LIKE ? OR d.last_name LIKE ? OR d.license_no LIKE ? OR d.employee_no LIKE ? OR d.phone LIKE ?)";
    const s = `%${search.trim()}%`;
    params.push(s, s, s, s, s);
  }
  if (["active", "inactive", "on_trip"].includes(status)) {
    where += " AND d.status = ?";
    params.push(status);
  }
  if (licenseType.trim()) {
    where += " AND d.license_type = ?";
    params.push(licenseType.trim());
  }

  const [rows] = await db.execute(
    `SELECT ${SELECT_COLS}
     FROM drivers d
     LEFT JOIN branches b ON b.branch_id = d.home_branch_id
     WHERE ${where}
     ORDER BY d.first_name ASC, d.last_name ASC`,
    params
  );

  res.json({ success: true, data: rows });
}

export async function getDriver(req, res) {
  const { companyId } = req.context;
  const id = Number(req.params.id);
  const [rows] = await db.execute(
    `SELECT ${SELECT_COLS}
     FROM drivers d
     LEFT JOIN branches b ON b.branch_id = d.home_branch_id
     WHERE d.driver_id = ? AND d.company_id = ? LIMIT 1`,
    [id, companyId]
  );
  if (!rows.length) {
    return res.status(404).json({ success: false, message: "Driver not found." });
  }
  res.json({ success: true, data: rows[0] });
}

export async function driverStats(req, res) {
  const { companyId } = req.context;
  const [rows] = await db.execute(
    `SELECT ${OPERATIONAL_STATUS_SQL} AS s, COUNT(*) AS n
     FROM drivers d WHERE d.company_id = ? GROUP BY s`,
    [companyId]
  );
  const by = Object.fromEntries(rows.map((r) => [r.s, Number(r.n)]));
  res.json({
    success: true,
    data: {
      total: rows.reduce((a, r) => a + Number(r.n), 0),
      available: by.available || 0,
      onTrip: by.on_trip || 0,
      inactive: by.inactive || 0,
    },
  });
}

export async function createDriver(req, res) {
  const { companyId } = req.context;
  const b = req.body;
  const firstName = STR(b.firstName);
  const lastName = STR(b.lastName);
  const licenseNo = STR(b.licenseNo);
  const licenseExpiry = STR(b.licenseExpiry);

  if (!firstName || !lastName || !licenseNo || !licenseExpiry) {
    return res.status(400).json({
      success: false,
      message: "First name, last name, license number and license expiry are required.",
    });
  }

  const [dupe] = await db.execute(
    "SELECT driver_id FROM drivers WHERE company_id = ? AND license_no = ? LIMIT 1",
    [companyId, licenseNo]
  );
  if (dupe.length) {
    return res.status(409).json({ success: false, message: "A driver with that license number already exists." });
  }

  /*
   * The number the driver signs in with.
   *
   * Not optional, whatever the form says: the Driver App authenticates on
   * employee_no, so a driver without one cannot sign in at all. This was left
   * null while the screens showed a number derived from the row id and told
   * the office to hand it over — which is how every driver added through the
   * web ended up unable to log in. Supplied by the office when they have a
   * numbering of their own, allocated here when they do not.
   */
  const employeeNo = STR(b.employeeNo) || (await nextEmployeeNo(companyId));

  const [takenNo] = await db.execute(
    "SELECT driver_id FROM drivers WHERE company_id = ? AND employee_no = ? LIMIT 1",
    [companyId, employeeNo]
  );
  if (takenNo.length) {
    return res.status(409).json({
      success: false,
      message: `Employee number ${employeeNo} already belongs to another driver.`,
    });
  }

  const [result] = await db.execute(
    `INSERT INTO drivers
       (company_id, home_branch_id, employee_no, first_name, last_name, phone,
        license_no, license_type, license_expiry,
        emergency_contact_name, emergency_contact_phone, emergency_contact_relation, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      companyId, NUM(b.homeBranchId) || req.context.branchId,
      employeeNo, firstName, lastName, STR(b.phone),
      licenseNo, STR(b.licenseType), licenseExpiry,
      STR(b.emergencyContactName), STR(b.emergencyContactPhone), STR(b.emergencyContactRelation),
      ["active", "inactive"].includes(b.status) ? b.status : "active",
    ]
  );

  await recordAudit(req, {
    module: "fleet", action: "driver.create", entityType: "driver", entityId: result.insertId,
    summary: `Added driver ${firstName} ${lastName}`,
  });

  res.status(201).json({ success: true, data: { driverId: result.insertId } });
}

/**
 * The next free DRV-### for a company.
 *
 * Continues that company's own numbering rather than restarting at 001, and
 * steps over anything already taken, so a number somebody typed by hand can
 * never be handed out twice.
 */
async function nextEmployeeNo(companyId) {
  const [[peak]] = await db.execute(
    `SELECT MAX(CAST(SUBSTRING(employee_no, 5) AS UNSIGNED)) AS top
       FROM drivers
      WHERE company_id = ? AND employee_no REGEXP '^DRV-[0-9]+$'`,
    [companyId]
  );

  let n = Number(peak?.top || 0) + 1;
  for (;;) {
    const candidate = `DRV-${String(n).padStart(3, "0")}`;
    // eslint-disable-next-line no-await-in-loop
    const [[clash]] = await db.execute(
      "SELECT driver_id FROM drivers WHERE company_id = ? AND employee_no = ? LIMIT 1",
      [companyId, candidate]
    );
    if (!clash) return candidate;
    n += 1;
  }
}

const UPDATABLE = {
  employeeNo: "employee_no", firstName: "first_name", lastName: "last_name", phone: "phone",
  licenseNo: "license_no", licenseType: "license_type", licenseExpiry: "license_expiry",
  emergencyContactName: "emergency_contact_name", emergencyContactPhone: "emergency_contact_phone",
  emergencyContactRelation: "emergency_contact_relation", homeBranchId: "home_branch_id",
};

export async function updateDriver(req, res) {
  const { companyId } = req.context;
  const id = Number(req.params.id);

  const [existing] = await db.execute(
    "SELECT driver_id, status FROM drivers WHERE driver_id = ? AND company_id = ? LIMIT 1",
    [id, companyId]
  );
  if (!existing.length) {
    return res.status(404).json({ success: false, message: "Driver not found." });
  }

  const fields = [];
  const params = [];
  for (const [key, col] of Object.entries(UPDATABLE)) {
    if (req.body[key] !== undefined) {
      fields.push(`${col} = ?`);
      params.push(key === "homeBranchId" ? NUM(req.body[key]) : STR(req.body[key]));
    }
  }
  if (["active", "inactive"].includes(req.body.status)) {
    // Don't deactivate a driver mid-trip.
    if (req.body.status === "inactive") {
      const [onTrip] = await db.execute(
        `SELECT 1 FROM trip_assignments ta JOIN trip_tickets tt ON tt.trip_ticket_id = ta.trip_ticket_id
         WHERE ta.driver_id = ? AND ta.is_current = TRUE
           AND tt.status IN ('assigned','accepted','released','in_transit') LIMIT 1`,
        [id]
      );
      if (onTrip.length) {
        return res.status(409).json({ success: false, message: "This driver is on an active trip and can't be deactivated." });
      }
    }
    fields.push("status = ?");
    params.push(req.body.status);
  }
  if (!fields.length) {
    return res.status(400).json({ success: false, message: "Nothing to update." });
  }

  params.push(id);
  await db.execute(`UPDATE drivers SET ${fields.join(", ")} WHERE driver_id = ?`, params);

  await recordAudit(req, {
    module: "fleet", action: "driver.update", entityType: "driver", entityId: id,
    summary: `Updated driver #${id}`, metadata: req.body,
  });

  res.json({ success: true });
}

/** Set / reset the Driver App PIN and toggle app access. */
export async function setDriverAppAccess(req, res) {
  const { companyId } = req.context;
  const id = Number(req.params.id);
  const [[drv]] = await db.execute(
    "SELECT driver_id FROM drivers WHERE driver_id = ? AND company_id = ? LIMIT 1",
    [id, companyId]
  );
  if (!drv) return res.status(404).json({ success: false, message: "Driver not found." });

  const sets = [];
  const params = [];

  if (req.body.pin !== undefined) {
    const pin = String(req.body.pin).trim();
    if (!/^\d{4,6}$/.test(pin)) {
      return res.status(400).json({ success: false, message: "PIN must be 4 to 6 digits." });
    }
    sets.push("pin_hash = ?");
    params.push(await bcrypt.hash(pin, 10));
    sets.push("app_enabled = 1");
  }
  if (req.body.appEnabled !== undefined && req.body.pin === undefined) {
    sets.push("app_enabled = ?");
    params.push(req.body.appEnabled ? 1 : 0);
  }
  if (!sets.length) return res.status(400).json({ success: false, message: "Nothing to update." });

  params.push(id);
  await db.execute(`UPDATE drivers SET ${sets.join(", ")} WHERE driver_id = ?`, params);
  await recordAudit(req, {
    module: "fleet", action: "driver.app_access", entityType: "driver", entityId: id,
    summary: req.body.pin !== undefined ? `Set Driver App PIN for driver #${id}` : `Driver App ${req.body.appEnabled ? "enabled" : "disabled"} for driver #${id}`,
  });
  res.json({ success: true });
}
