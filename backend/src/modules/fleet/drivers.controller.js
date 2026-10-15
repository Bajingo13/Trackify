import bcrypt from "bcrypt";
import db from "../../config/db.js";
import { recordAudit } from "../../shared/audit.js";
import { expiryState, describeExpiry, dateOnly, DEFAULT_LICENSE_TYPE, LICENSE_TYPES } from "../../shared/driverLicense.js";
import { toRelative, discard } from "../finance/receipts.storage.js";
import { scanUpload } from "../../shared/licenseScan/licenseScan.service.js";

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
  (d.license_photo_path IS NOT NULL) AS has_license_photo,
  d.emergency_contact_name, d.emergency_contact_phone, d.emergency_contact_relation,
  d.app_enabled, (d.pin_hash IS NOT NULL) AS has_pin,
  (d.photo_path IS NOT NULL) AS has_photo, d.photo_updated_at,
  d.status, ${OPERATIONAL_STATUS_SQL} AS operational_status,
  d.created_at, d.updated_at`;

const NUM = (v) => (v === "" || v == null ? null : Number(v));
const STR = (v) => (v === "" || v == null ? null : String(v).trim());

function withLicenseState(row, now = new Date()) {
  const licence = expiryState(row.license_expiry, now);
  return {
    ...row,
    license_state: licence.state,
    license_days_left: licence.daysLeft,
    license_expiry_text: describeExpiry(licence.daysLeft),
  };
}

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

  const now = new Date();
  res.json({ success: true, data: rows.map((row) => withLicenseState(row, now)) });
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
  res.json({ success: true, data: withLicenseState(rows[0]) });
}

/** Check the sign-in name before the Admin moves to the profile step. */
export async function checkEmployeeNo(req, res) {
  const { companyId } = req.context;
  const employeeNo = STR(req.query.employeeNo);
  if (!employeeNo) {
    return res.status(400).json({ success: false, message: "Employee Number is required." });
  }
  const [[driver]] = await db.execute(
    "SELECT driver_id FROM drivers WHERE company_id = ? AND employee_no = ? LIMIT 1",
    [companyId, employeeNo]
  );
  res.json({ success: true, data: { available: !driver } });
}

export async function driverStats(req, res) {
  const { companyId } = req.context;
  const [rows] = await db.execute(
    `SELECT ${OPERATIONAL_STATUS_SQL} AS s, COUNT(*) AS n
     FROM drivers d WHERE d.company_id = ? GROUP BY s`,
    [companyId]
  );
  const by = Object.fromEntries(rows.map((r) => [r.s, Number(r.n)]));

  // Licences the office has to act on. Inactive drivers are left out: nobody is
  // going to dispatch them, so their paperwork is not today's problem. Counted
  // with the same rule as everywhere else (shared/driverLicense.js), and not in
  // SQL, so the number here can never disagree with the badge on the row.
  const [licences] = await db.execute(
    `SELECT license_expiry FROM drivers
      WHERE company_id = ? AND status <> 'inactive'`,
    [companyId]
  );
  const now = new Date();
  const states = licences.map((d) => expiryState(d.license_expiry, now).state);

  res.json({
    success: true,
    data: {
      total: rows.reduce((a, r) => a + Number(r.n), 0),
      available: by.available || 0,
      onTrip: by.on_trip || 0,
      inactive: by.inactive || 0,
      licence: {
        expired: states.filter((s) => s === "expired").length,
        expiring: states.filter((s) => s === "expiring").length,
      },
    },
  });
}

/**
 * Register a driver. multipart: the licence photo ("photo") and the details.
 *
 * A driver cannot be registered without credentials, a licence the server can
 * read, and an explicit Admin review. OCR proposes values rather than deciding
 * them, so an Admin may correct a misread character after comparing the form
 * with the photo. Credentials, profile and photo are written in one insert;
 * a failed registration leaves no partial account or stray file behind.
 *
 * What is saved is what the Driver App then shows: it reads these same columns.
 */
export async function createDriver(req, res) {
  const { companyId } = req.context;
  const b = req.body;
  const file = req.file || null;

  // Every way out of here that is not a success removes the uploaded file.
  const refuse = (status, body) => {
    if (file) discard(file.path);
    return res.status(status).json({ success: false, ...body });
  };

  const employeeNo = STR(b.employeeNo);
  const pin = String(b.pin ?? "").trim();
  if (!employeeNo) {
    return refuse(400, { code: "EMPLOYEE_NUMBER_REQUIRED", message: "Employee Number is required." });
  }
  if (!/^\d{4,6}$/.test(pin)) {
    return refuse(400, { code: "PIN_INVALID", message: "PIN must be 4 to 6 digits." });
  }
  if (String(b.licenseReviewed).toLowerCase() !== "true") {
    return refuse(400, {
      code: "LICENSE_REVIEW_REQUIRED",
      message: "Review the extracted details against the licence and confirm they are correct before saving.",
    });
  }

  if (!file) {
    return refuse(400, {
      code: "LICENSE_PHOTO_REQUIRED",
      message: "A clear photo or scanned copy of the driver's licence is required to register a driver.",
    });
  }

  const firstName = STR(b.firstName);
  const lastName = STR(b.lastName);
  const phone = STR(b.phone);
  const licenseNo = STR(b.licenseNo);
  const licenseExpiry = dateOnly(STR(b.licenseExpiry));
  const licenseType = STR(b.licenseType) || DEFAULT_LICENSE_TYPE;

  if (!firstName || !lastName || !phone || !licenseNo || !licenseExpiry) {
    return refuse(400, { message: "First name, last name, contact number, license number and license expiry are required." });
  }
  if (!LICENSE_TYPES.includes(licenseType)) {
    return refuse(400, { message: "Select a valid license type." });
  }

  const [dupe] = await db.execute(
    "SELECT driver_id FROM drivers WHERE company_id = ? AND license_no = ? LIMIT 1",
    [companyId, licenseNo]
  );
  if (dupe.length) {
    return refuse(409, { message: "A driver with that license number already exists." });
  }

  // Employee Number is the Driver App sign-in name and is unique per company.
  const [takenNo] = await db.execute(
    "SELECT driver_id FROM drivers WHERE company_id = ? AND employee_no = ? LIMIT 1",
    [companyId, employeeNo]
  );
  if (takenNo.length) {
    return refuse(409, { message: `Employee number ${employeeNo} already belongs to another driver.` });
  }

  /* Read the photograph independently of the browser-side preview. */
  let scan;
  try {
    scan = await scanUpload(file, `staff:${req.user?.userId ?? req.context.userId}`, { keep: true });
  } catch (error) {
    // busy, out of allowance, too slow: not the licence's fault, so say so and let them retry
    return refuse(error.status || 503, { code: "LICENSE_SCAN_FAILED", message: error.message });
  }

  if (scan.status !== "read" || Number(scan.found || 0) < 1) {
    return refuse(422, {
      code: "LICENSE_UNREADABLE",
      message: scan.message || "The licence could not be read. Upload a clearer, closer photo of the whole licence, flat and in good light.",
    });
  }

  const pinHash = await bcrypt.hash(pin, 10);

  let result;
  try {
    [result] = await db.execute(
      `INSERT INTO drivers
         (company_id, home_branch_id, employee_no, first_name, last_name, phone,
          license_no, license_type, license_expiry,
          license_photo_path, license_photo_mime, license_photo_size, license_photo_updated_at, license_photo_by_driver,
          emergency_contact_name, emergency_contact_phone, emergency_contact_relation,
          pin_hash, app_enabled, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 0, ?, ?, ?, ?, 1, ?)`,
      [
        companyId, NUM(b.homeBranchId) || req.context.branchId,
        employeeNo, firstName, lastName, phone,
        licenseNo, licenseType, licenseExpiry,
        toRelative(file.path), file.mimetype, file.size,
        STR(b.emergencyContactName), STR(b.emergencyContactPhone), STR(b.emergencyContactRelation),
        pinHash,
        ["active", "inactive"].includes(b.status) ? b.status : "active",
      ]
    );
  } catch (error) {
    discard(file.path);
    if (error?.code === "ER_DUP_ENTRY" && /employee/i.test(error.message || "")) {
      return res.status(409).json({ success: false, message: `Employee number ${employeeNo} already belongs to another driver.` });
    }
    throw error;
  }

  await recordAudit(req, {
    module: "fleet", action: "driver.create", entityType: "driver", entityId: result.insertId,
    summary: `Added driver ${firstName} ${lastName} with Admin-reviewed OCR licence details and Driver App access`,
  });

  res.status(201).json({ success: true, data: { driverId: result.insertId } });
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
    "SELECT driver_id, status, employee_no, license_no FROM drivers WHERE driver_id = ? AND company_id = ? LIMIT 1",
    [id, companyId]
  );
  if (!existing.length) {
    return res.status(404).json({ success: false, message: "Driver not found." });
  }

  if (req.body.employeeNo !== undefined) {
    const employeeNo = STR(req.body.employeeNo);
    if (!employeeNo) return res.status(400).json({ success: false, message: "Employee Number is required." });
    const [[other]] = await db.execute(
      "SELECT driver_id FROM drivers WHERE company_id = ? AND employee_no = ? AND driver_id <> ? LIMIT 1",
      [companyId, employeeNo, id]
    );
    if (other) return res.status(409).json({ success: false, message: `Employee number ${employeeNo} already belongs to another driver.` });
  }
  if (req.body.licenseNo !== undefined) {
    const licenseNo = STR(req.body.licenseNo);
    if (!licenseNo) return res.status(400).json({ success: false, message: "License Number is required." });
    const [[other]] = await db.execute(
      "SELECT driver_id FROM drivers WHERE company_id = ? AND license_no = ? AND driver_id <> ? LIMIT 1",
      [companyId, licenseNo, id]
    );
    if (other) return res.status(409).json({ success: false, message: "A driver with that license number already exists." });
  }
  if (req.body.licenseType !== undefined && !LICENSE_TYPES.includes(STR(req.body.licenseType))) {
    return res.status(400).json({ success: false, message: "Select a valid license type." });
  }
  if (req.body.licenseExpiry !== undefined && !dateOnly(STR(req.body.licenseExpiry))) {
    return res.status(400).json({ success: false, message: "Enter a valid license expiry date." });
  }

  const fields = [];
  const params = [];
  for (const [key, col] of Object.entries(UPDATABLE)) {
    if (req.body[key] !== undefined) {
      fields.push(`${col} = ?`);
      params.push(key === "homeBranchId" ? NUM(req.body[key]) : key === "licenseExpiry" ? dateOnly(STR(req.body[key])) : STR(req.body[key]));
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
