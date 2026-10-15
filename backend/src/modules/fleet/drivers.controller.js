import bcrypt from "bcrypt";
import db from "../../config/db.js";
import { recordAudit } from "../../shared/audit.js";
import {
  expiryState, describeExpiry, dateOnly, licenceKey, driverAvailability, implausibleExpiry,
  DEFAULT_LICENSE_TYPE, LICENSE_TYPES,
} from "../../shared/driverLicense.js";
import { toRelative, discard } from "../finance/receipts.storage.js";
import { scanUpload } from "../../shared/licenseScan/licenseScan.service.js";
import { disconnectDriver } from "../../realtime/hub.js";

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

/**
 * The driver in this company who already holds a licence number, if any,
 * compared however it was typed (licenceKey: "N01-12-345678" = "n01 12 345678").
 * Inactive drivers count: a licence still belongs to the person who left, and
 * the way back for them is Reactivate, not a second record.
 */
export async function findLicenceHolder(companyId, licenseNo, exceptDriverId = 0) {
  const key = licenceKey(licenseNo);
  if (!key) return null;
  const [[holder]] = await db.execute(
    `SELECT driver_id, employee_no, first_name, last_name, status FROM drivers
      WHERE company_id = ? AND license_key = ? AND driver_id <> ? LIMIT 1`,
    [companyId, key, Number(exceptDriverId) || 0]
  );
  return holder || null;
}

/** The refusal for a licence someone else holds, naming them and what to do. */
export function licenceTaken(holder) {
  const name = `${holder.first_name} ${holder.last_name}`.trim();
  const who = holder.employee_no ? `${name} (${holder.employee_no})` : name;
  const inactive = holder.status === "inactive";
  return {
    code: inactive ? "LICENSE_ON_INACTIVE_DRIVER" : "LICENSE_DUPLICATE",
    message: inactive
      ? `This licence belongs to ${who}, who is inactive. Reactivate them from the driver list instead of registering them again.`
      : `This licence already belongs to ${who}.`,
    holder: { driverId: holder.driver_id, name, employeeNo: holder.employee_no || null, status: holder.status },
  };
}

/** The unique key on (company_id, license_key) caught a duplicate the check above raced past. */
const isLicenceClash = (error) => error?.code === "ER_DUP_ENTRY" && /license_key/i.test(error.message || "");

function withLicenseState(row, now = new Date()) {
  const licence = expiryState(row.license_expiry, now);
  return {
    ...row,
    // a free driver whose licence has lapsed is not "available": dispatch refuses them
    ...(row.operational_status !== undefined && { operational_status: driverAvailability(row.operational_status, row.license_expiry, now) }),
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

export async function driverStats(req, res) {
  const { companyId } = req.context;
  // One row per driver, classified here rather than counted in SQL, with the
  // same rules as the rows on the list (shared/driverLicense.js), so a figure
  // here can never disagree with the badge on the row it counts.
  const [rows] = await db.execute(
    `SELECT ${OPERATIONAL_STATUS_SQL} AS s, d.license_expiry
       FROM drivers d WHERE d.company_id = ?`,
    [companyId]
  );
  const now = new Date();
  const count = (test) => rows.filter(test).length;

  // Licences the office has to act on. Inactive drivers are left out: nobody is
  // going to dispatch them, so their paperwork is not today's problem.
  const working = rows.filter((r) => r.s !== "inactive");
  const states = working.map((d) => expiryState(d.license_expiry, now).state);

  res.json({
    success: true,
    data: {
      total: rows.length,
      // only drivers dispatch would accept: not one whose licence has lapsed
      available: count((r) => driverAvailability(r.s, r.license_expiry, now) === "available"),
      onTrip: count((r) => r.s === "on_trip"),
      inactive: count((r) => r.s === "inactive"),
      // free, but grounded by their licence (expired, or no expiry on record)
      licenceBlocked: count((r) => ["licence_expired", "no_licence_expiry"].includes(driverAvailability(r.s, r.license_expiry, now))),
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

  // No Employee Number is read from the request: the system assigns it (below),
  // so a number typed by hand can never collide with, or impersonate, another.
  const pin = String(b.pin ?? "").trim();
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
  const badExpiry = implausibleExpiry(licenseExpiry);
  if (badExpiry) return refuse(400, { code: "LICENSE_EXPIRY_IMPLAUSIBLE", message: badExpiry });

  const holder = await findLicenceHolder(companyId, licenseNo);
  if (holder) return refuse(409, licenceTaken(holder));

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

  /*
   * The Employee Number — what the driver signs in to the Driver App with — is
   * assigned here, never typed. It continues the system-wide DRV-### sequence
   * (nextEmployeeNo). Within a company the unique key on (company_id,
   * employee_no) is the guarantee: two registrations that pick the same next
   * number at the same moment cannot both be written, and the one that loses
   * takes the number after. Across companies, see the check after the insert.
   */
  const insertWith = (employeeNo) => db.execute(
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

  let result;
  let employeeNo;
  try {
    for (let attempt = 1; ; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop
      employeeNo = await nextEmployeeNo(companyId);
      try {
        // eslint-disable-next-line no-await-in-loop
        [result] = await insertWith(employeeNo);
        break;
      } catch (error) {
        const lostRace = error?.code === "ER_DUP_ENTRY" && /uq_driver_employee_no|employee/i.test(error.message || "");
        if (!lostRace || attempt >= EMPLOYEE_NO_ATTEMPTS) throw error;
      }
    }
  } catch (error) {
    discard(file.path);
    // Another registration with the same licence was saved between our check and our insert.
    if (isLicenceClash(error)) {
      const taken = await findLicenceHolder(companyId, licenseNo);
      return res.status(409).json({ success: false, ...(taken ? licenceTaken(taken) : { code: "LICENSE_DUPLICATE", message: "This licence already belongs to another driver." }) });
    }
    throw error;
  }

  // The unique key is per company, so it cannot stop a registration at another
  // company taking the same number at the same moment. Checked once written:
  // the earlier row keeps it, and this one moves to the next free number before
  // anyone has been told it. (Nobody else can rely on it yet, so moving is safe.)
  for (let attempt = 1; attempt <= EMPLOYEE_NO_ATTEMPTS; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const [[earlier]] = await db.execute(
      "SELECT driver_id FROM drivers WHERE employee_no = ? AND driver_id < ? LIMIT 1",
      [employeeNo, result.insertId]
    );
    if (!earlier) break;
    // eslint-disable-next-line no-await-in-loop
    const next = await nextEmployeeNo(companyId);
    try {
      // eslint-disable-next-line no-await-in-loop
      await db.execute("UPDATE drivers SET employee_no = ? WHERE driver_id = ?", [next, result.insertId]);
      employeeNo = next;
    } catch (error) {
      const lostRace = error?.code === "ER_DUP_ENTRY" && /uq_driver_employee_no|employee/i.test(error.message || "");
      if (!lostRace) throw error;
    }
  }

  await recordAudit(req, {
    module: "fleet", action: "driver.create", entityType: "driver", entityId: result.insertId,
    summary: `Added driver ${firstName} ${lastName} as ${employeeNo}, with Admin-reviewed OCR licence details and Driver App access`,
  });

  // The office needs the number to hand to the driver with their PIN.
  res.status(201).json({ success: true, data: { driverId: result.insertId, employeeNo } });
}

/** Retries when another registration takes the same next number at the same moment. */
const EMPLOYEE_NO_ATTEMPTS = 5;

/**
 * The next free DRV-###, across every company.
 *
 * The Driver App signs in with the Employee Number and a PIN and is not told the
 * company, so a number that exists at two companies leaves sign-in to tell them
 * apart by PIN alone (driver.controller.js refuses when both match). Numbering
 * per company made that routine — every company's first driver was DRV-001 —
 * so new numbers continue one system-wide sequence and are never handed out
 * twice anywhere. Numbers already issued are left as they are: changing one
 * would lock its driver out.
 *
 * (companyId is kept for the callers and the per-company unique key, which
 * still guards a race within one company; see createDriver's retry.)
 */
export async function nextEmployeeNo(_companyId) {
  const [[peak]] = await db.execute(
    `SELECT MAX(CAST(SUBSTRING(employee_no, 5) AS UNSIGNED)) AS top
       FROM drivers
      WHERE employee_no REGEXP '^DRV-[0-9]+$'`
  );
  let n = Number(peak?.top || 0) + 1;
  for (;;) {
    const candidate = `DRV-${String(n).padStart(3, "0")}`;
    // eslint-disable-next-line no-await-in-loop
    const [[clash]] = await db.execute(
      "SELECT driver_id FROM drivers WHERE employee_no = ? LIMIT 1",
      [candidate]
    );
    if (!clash) return candidate;
    n += 1;
  }
}

const UPDATABLE = {
  firstName: "first_name", lastName: "last_name", phone: "phone",
  licenseNo: "license_no", licenseType: "license_type", licenseExpiry: "license_expiry",
  emergencyContactName: "emergency_contact_name", emergencyContactPhone: "emergency_contact_phone",
  emergencyContactRelation: "emergency_contact_relation", homeBranchId: "home_branch_id",
};

export async function updateDriver(req, res) {
  const { companyId } = req.context;
  const id = Number(req.params.id);

  const [existing] = await db.execute(
    "SELECT driver_id, status, employee_no, license_no, license_expiry FROM drivers WHERE driver_id = ? AND company_id = ? LIMIT 1",
    [id, companyId]
  );
  if (!existing.length) {
    return res.status(404).json({ success: false, message: "Driver not found." });
  }

  // The Employee Number is assigned by the system and is the driver's sign-in
  // name: changing it would lock them out of the Driver App. Sending it back
  // unchanged is harmless; asking to change it is refused, not silently ignored.
  if (req.body.employeeNo !== undefined && STR(req.body.employeeNo) !== existing[0].employee_no) {
    return res.status(400).json({ success: false, code: "EMPLOYEE_NUMBER_READ_ONLY", message: "Employee numbers are assigned by the system and cannot be changed." });
  }
  if (req.body.licenseNo !== undefined) {
    const licenseNo = STR(req.body.licenseNo);
    if (!licenseNo) return res.status(400).json({ success: false, message: "License Number is required." });
    const holder = await findLicenceHolder(companyId, licenseNo, id);
    if (holder) return res.status(409).json({ success: false, ...licenceTaken(holder) });
  }
  if (req.body.licenseType !== undefined && !LICENSE_TYPES.includes(STR(req.body.licenseType))) {
    return res.status(400).json({ success: false, message: "Select a valid license type." });
  }
  if (req.body.licenseExpiry !== undefined) {
    const expiry = dateOnly(STR(req.body.licenseExpiry));
    if (!expiry) return res.status(400).json({ success: false, message: "Enter a valid license expiry date." });
    // Judged only when it changes: the edit form sends every field back, and a
    // date already on file (from before this check) must not block an edit to
    // the driver's phone number.
    const unchanged = expiry === dateOnly(existing[0].license_expiry);
    const badExpiry = unchanged ? null : implausibleExpiry(expiry);
    if (badExpiry) return res.status(400).json({ success: false, code: "LICENSE_EXPIRY_IMPLAUSIBLE", message: badExpiry });
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
  try {
    await db.execute(`UPDATE drivers SET ${fields.join(", ")} WHERE driver_id = ?`, params);
  } catch (error) {
    if (!isLicenceClash(error)) throw error;
    const taken = await findLicenceHolder(companyId, req.body.licenseNo, id);
    return res.status(409).json({ success: false, ...(taken ? licenceTaken(taken) : { code: "LICENSE_DUPLICATE", message: "This licence already belongs to another driver." }) });
  }

  // Bringing a driver back is its own event in the log, not a generic edit:
  // it restores their Driver App sign-in and puts them back on the dispatch list.
  const was = existing[0].status;
  const reactivated = was === "inactive" && req.body.status === "active";
  const deactivated = was !== "inactive" && req.body.status === "inactive";
  const label = existing[0].employee_no || `#${id}`;
  // no longer allowed to sign in, so no longer on the live line either
  if (deactivated) disconnectDriver(companyId, id);
  await recordAudit(req, {
    module: "fleet",
    action: reactivated ? "driver.reactivate" : deactivated ? "driver.deactivate" : "driver.update",
    entityType: "driver", entityId: id,
    summary: reactivated ? `Reactivated driver ${label}` : deactivated ? `Deactivated driver ${label}` : `Updated driver ${label}`,
    metadata: req.body,
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
  // app access withdrawn: end any live connection the Driver App still holds
  if (req.body.appEnabled !== undefined && req.body.pin === undefined && !req.body.appEnabled) disconnectDriver(companyId, id);
  await recordAudit(req, {
    module: "fleet", action: "driver.app_access", entityType: "driver", entityId: id,
    summary: req.body.pin !== undefined ? `Set Driver App PIN for driver #${id}` : `Driver App ${req.body.appEnabled ? "enabled" : "disabled"} for driver #${id}`,
  });
  res.json({ success: true });
}
