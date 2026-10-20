/**
 * The driver's own account.
 *
 * Everything here is scoped to req.driver — a driver can only ever read or
 * change their own record, and the driver id never comes from the request
 * body. That is the whole security model of this file, and it is why no
 * handler below takes an id parameter.
 *
 * What a driver may change is deliberately narrow. Their phone number and who
 * to call in an emergency are theirs, and being unable to correct them from the
 * road is how a number goes stale for two years.
 *
 * Their licence is not theirs to change. It is a compliance record the company is
 * audited on — the expiry decides whether they may be dispatched at all — so the
 * office is the only one who adds or edits it, and the app only SHOWS it. It reads
 * the same columns the office writes, so a change in the back office is what the
 * driver sees on their next load, with nothing to keep in step.
 */
import fsSync from "node:fs";
import bcrypt from "bcrypt";
import db from "../../config/db.js";
import { recordAudit } from "../../shared/audit.js";
import { weakPinProblem } from "../../shared/driverPin.js";
import { sendDriverMail } from "../../shared/driverMail.js";
import { driverPinChangedEmail } from "../../shared/driverPin.email.js";
import { toRelative, toAbsolute, discard, streamFile } from "../finance/receipts.storage.js";
import { expiryState, DEFAULT_LICENSE_TYPE } from "../../shared/driverLicense.js";

/* ---------------------------------------------------------------- */
/* Profile                                                          */
/* ---------------------------------------------------------------- */

/*
 * The days left on the licence are counted here (see shared/driverLicense.js)
 * rather than on the phone. A device clock can be wrong by years, sometimes
 * deliberately; an expiry warning a driver can silence by changing their date
 * settings is not a warning, so the server does the arithmetic and the app
 * only renders it.
 */

const PROFILE_SELECT = `
  d.driver_id, d.employee_no, d.first_name, d.last_name, d.phone, d.email,
  d.license_no, d.license_type, d.license_expiry,
  d.emergency_contact_name, d.emergency_contact_phone, d.emergency_contact_relation,
  d.status, d.created_at, d.photo_path, d.photo_updated_at,
  d.license_photo_path, d.license_photo_updated_at,
  b.branch_name, b.branch_code, co.company_name
`;

async function loadProfile(driverId, companyId) {
  const [[d]] = await db.execute(
    `SELECT ${PROFILE_SELECT}
       FROM drivers d
       LEFT JOIN branches b ON b.branch_id = d.home_branch_id
       LEFT JOIN companies co ON co.company_id = d.company_id
      WHERE d.driver_id = ? AND d.company_id = ? LIMIT 1`,
    [driverId, companyId]
  );
  if (!d) return null;

  // Runs behind them, and ground covered. A driver checks these against their
  // own memory, so they count finished work only — a run still moving is not
  // yet a run they did, and a cancelled one never was.
  //
  // is_current matters more than it looks: a trip reassigned between drivers
  // keeps a row per assignment, so without it one run counts two or three
  // times and the driver is shown a number they know is wrong.
  const [[tally]] = await db.execute(
    `SELECT COUNT(*) AS trips, COALESCE(SUM(tt.route_distance_km), 0) AS km
       FROM trip_assignments ta
       JOIN trip_tickets tt ON tt.trip_ticket_id = ta.trip_ticket_id
      WHERE ta.driver_id = ? AND ta.is_current = TRUE AND tt.company_id = ?
        AND tt.status IN ('delivered','returned','operationally_closed')`,
    [driverId, companyId]
  );

  const expiryLicense = expiryState(d.license_expiry);

  return {
    driverId: d.driver_id,
    employeeNo: d.employee_no,
    name: `${d.first_name} ${d.last_name}`.trim(),
    firstName: d.first_name,
    lastName: d.last_name,
    phone: d.phone,
    // Where sign-in codes for a new phone are sent. Set by the office, read-only here.
    email: d.email || null,
    license: {
      no: d.license_no,
      // the same default the office screens show, so the two never read differently
      type: d.license_type || (d.license_no ? DEFAULT_LICENSE_TYPE : null),
      expiry: d.license_expiry,
      daysLeft: expiryLicense.daysLeft,
      // none | valid | expiring | expired — decided here so the app, the office
      // and the reminders can never disagree about which one it is
      state: expiryLicense.state,
      // A photograph of the licence itself, which the office may need on file.
      // Same cache-busting reason as the profile photo below.
      hasPhoto: Boolean(d.license_photo_path),
      photoUpdatedAt: d.license_photo_updated_at,
    },
    emergency: {
      name: d.emergency_contact_name,
      phone: d.emergency_contact_phone,
      relation: d.emergency_contact_relation,
    },
    branch: d.branch_name,
    branchCode: d.branch_code,
    company: d.company_name,
    status: d.status,
    since: d.created_at,
    hasPhoto: Boolean(d.photo_path),
    // The app appends this to the photo URL. Without it a driver changes their
    // photo, the URL does not change, the phone serves the cached one, and it
    // reads as an upload that failed.
    photoUpdatedAt: d.photo_updated_at,
    totals: {
      trips: Number(tally?.trips || 0),
      km: Math.round(Number(tally?.km || 0)),
    },
  };
}

export async function me(req, res) {
  const profile = await loadProfile(req.driver.driverId, req.driver.companyId);
  if (!profile) {
    return res.status(404).json({ success: false, message: "Your record could not be found." });
  }
  // The Admin Panel owns licence details. Never let an intermediary serve an
  // older profile after an authorized update.
  res.set?.("Cache-Control", "private, no-store");
  res.json({ success: true, data: profile });
}

/** Trimmed to null, so a field can be cleared and "" never reaches the column. */
function clean(value, max) {
  if (value === undefined) return undefined;
  const s = String(value ?? "").trim();
  return s ? s.slice(0, max) : null;
}

export async function updateMe(req, res) {
  const { driverId, companyId } = req.driver;

  const fields = {
    phone: clean(req.body.phone, 50),
    emergency_contact_name: clean(req.body.emergencyName, 120),
    emergency_contact_phone: clean(req.body.emergencyPhone, 50),
    emergency_contact_relation: clean(req.body.emergencyRelation, 60),
  };

  const set = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (!set.length) {
    return res.status(400).json({ success: false, message: "There was nothing to save." });
  }

  await db.execute(
    `UPDATE drivers SET ${set.map(([k]) => `${k} = ?`).join(", ")}
      WHERE driver_id = ? AND company_id = ?`,
    [...set.map(([, v]) => v), driverId, companyId]
  );

  res.json({ success: true, data: await loadProfile(driverId, companyId) });
}

/* ---------------------------------------------------------------- */
/* Profile photo                                                    */
/* ---------------------------------------------------------------- */

export async function uploadPhoto(req, res) {
  const { driverId, companyId } = req.driver;
  if (!req.file) {
    return res.status(400).json({ success: false, message: "No photo was attached." });
  }

  const [[existing]] = await db.execute(
    `SELECT photo_path FROM drivers WHERE driver_id = ? AND company_id = ? LIMIT 1`,
    [driverId, companyId]
  );

  try {
    await db.execute(
      `UPDATE drivers
          SET photo_path = ?, photo_mime = ?, photo_size = ?, photo_updated_at = NOW()
        WHERE driver_id = ? AND company_id = ?`,
      [toRelative(req.file.path), req.file.mimetype, req.file.size, driverId, companyId]
    );
  } catch (e) {
    // the row never took the new file, so the new file is litter
    discard(req.file.path);
    throw e;
  }

  // Only once the row points at the new photo. A crash between the two leaves
  // an orphaned file, which is harmless; the other order loses the photo.
  if (existing?.photo_path) {
    try {
      discard(toAbsolute(existing.photo_path));
    } catch {
      /* already gone */
    }
  }

  res.json({ success: true, data: await loadProfile(driverId, companyId) });
}

export async function photo(req, res) {
  const { driverId, companyId } = req.driver;
  const [[d]] = await db.execute(
    `SELECT photo_path, photo_mime FROM drivers
      WHERE driver_id = ? AND company_id = ? LIMIT 1`,
    [driverId, companyId]
  );
  if (!d?.photo_path) {
    return res.status(404).json({ success: false, message: "No photo yet." });
  }
  const abs = toAbsolute(d.photo_path);
  if (!fsSync.existsSync(abs)) {
    return res.status(404).json({ success: false, message: "The photo file is missing." });
  }
  // Safe to cache hard: the URL carries photo_updated_at, so a new photo is a
  // new URL. Private, because it is a photograph of a person.
  res.set("Cache-Control", "private, max-age=86400");
  res.type(d.photo_mime || "image/jpeg");
  streamFile(res, abs);
}

export async function removePhoto(req, res) {
  const { driverId, companyId } = req.driver;
  const [[d]] = await db.execute(
    `SELECT photo_path FROM drivers WHERE driver_id = ? AND company_id = ? LIMIT 1`,
    [driverId, companyId]
  );
  await db.execute(
    `UPDATE drivers
        SET photo_path = NULL, photo_mime = NULL, photo_size = NULL, photo_updated_at = NOW()
      WHERE driver_id = ? AND company_id = ?`,
    [driverId, companyId]
  );
  if (d?.photo_path) {
    try {
      discard(toAbsolute(d.photo_path));
    } catch {
      /* already gone */
    }
  }
  res.json({ success: true, data: await loadProfile(driverId, companyId) });
}

/* ---------------------------------------------------------------- */
/* Licence photo (view only)                                        */
/* ---------------------------------------------------------------- */

/*
 * Shows the driver the licence photo the office has on file. There is no way to
 * add, replace or remove it from here: the licence is the office's record, so the
 * app reads exactly what the office entered and cannot disagree with it.
 *
 * Not cached for a day, unlike the profile picture. A new photo has the same URL,
 * and a phone that kept showing the old licence after the office replaced it is
 * the one inconsistency this record must never have.
 */

export async function licensePhoto(req, res) {
  const { driverId, companyId } = req.driver;
  const [[d]] = await db.execute(
    `SELECT license_photo_path, license_photo_mime FROM drivers
      WHERE driver_id = ? AND company_id = ? LIMIT 1`,
    [driverId, companyId]
  );
  if (!d?.license_photo_path) {
    return res.status(404).json({ success: false, message: "No licence photo yet." });
  }
  const abs = toAbsolute(d.license_photo_path);
  if (!fsSync.existsSync(abs)) {
    return res.status(404).json({ success: false, message: "The licence photo is missing." });
  }
  res.set("Cache-Control", "private, no-cache");
  res.type(d.license_photo_mime || "image/jpeg");
  streamFile(res, abs);
}


/* History and claims                                               */
/* ---------------------------------------------------------------- */

/**
 * Runs already finished.
 *
 * Separate from GET /trips, which answers "what am I driving now" and
 * deliberately drops anything older than three days. This answers "what have I
 * driven", which is the question a driver has when they are checking their own
 * record against a payslip or a dispute.
 */
export async function history(req, res) {
  const { driverId, companyId } = req.driver;

  // Bounded and integer-checked rather than passed as a placeholder: MySQL
  // prepared statements do not reliably accept a parameter in LIMIT.
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 40, 1), 100);
  const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);

  const [rows] = await db.execute(
    `SELECT tt.trip_ticket_id AS id, tt.ticket_no AS ticketNo, tt.status,
            tt.origin, tt.destination,
            tt.route_distance_km AS routeKm,
            tt.scheduled_departure AS scheduledDeparture,
            tt.updated_at AS finishedAt,
            c.customer_name AS customer,
            v.plate_no AS vehicle, v.vehicle_type AS vehicleType,
            p.received_by AS receivedBy, p.captured_at AS deliveredAt
       FROM trip_assignments ta
       JOIN trip_tickets tt ON tt.trip_ticket_id = ta.trip_ticket_id
       LEFT JOIN customers c ON c.customer_id = tt.customer_id
       LEFT JOIN vehicles v ON v.vehicle_id = ta.vehicle_id
       LEFT JOIN trip_pod p ON p.trip_ticket_id = tt.trip_ticket_id
      WHERE ta.driver_id = ? AND ta.is_current = TRUE AND tt.company_id = ?
        AND tt.status IN ('delivered','returned','operationally_closed','cancelled')
      ORDER BY tt.updated_at DESC
      LIMIT ${limit} OFFSET ${offset}`,
    [driverId, companyId]
  );

  res.json({ success: true, data: rows, paging: { limit, offset, count: rows.length } });
}

/**
 * The claim lifecycle, as the driver experiences it rather than as finance
 * names it.
 *
 * 'recorded' means accepted into the books and 'reimbursed' means the money is
 * actually back — a distinction worth keeping, because collapsing them tells a
 * driver they are still owed for something they were paid for last month, and
 * that is the kind of error that ends with someone claiming twice.
 */
const BUCKET = {
  submitted: "waiting",
  recorded: "approved",
  on_voucher: "approved",
  reimbursed: "paid",
  rejected: "rejected",
};

/**
 * Every claim this driver has filed, newest first.
 *
 * The per-trip list already exists, but it only answers the question while the
 * driver still has the trip open. "Am I getting paid back for that fuel I
 * bought in Tagum last week" is asked away from any trip, and until now the app
 * could not answer it at all.
 */
export async function allExpenses(req, res) {
  const { driverId, companyId } = req.driver;
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 60, 1), 200);

  const [rows] = await db.execute(
    `SELECT e.expense_id, e.trip_ticket_id, e.category, e.description, e.amount,
            e.expense_date, e.receipt_no, e.status, e.review_note, e.reviewed_at,
            e.created_at, tt.ticket_no,
            (SELECT COUNT(*) FROM expense_attachments a WHERE a.expense_id = e.expense_id)
              AS attachment_count
       FROM trip_expenses e
       JOIN trip_tickets tt ON tt.trip_ticket_id = e.trip_ticket_id
      WHERE e.submitted_by_driver_id = ? AND tt.company_id = ?
      ORDER BY e.expense_id DESC
      LIMIT ${limit}`,
    [driverId, companyId]
  );

  const totals = { waiting: 0, approved: 0, paid: 0, rejected: 0 };
  for (const r of rows) {
    totals[BUCKET[r.status] || "waiting"] += Number(r.amount);
  }

  res.json({
    success: true,
    data: rows.map((r) => ({
      id: r.expense_id,
      tripTicketId: r.trip_ticket_id,
      ticketNo: r.ticket_no,
      category: r.category,
      description: r.description,
      amount: Number(r.amount),
      expenseDate: r.expense_date,
      receiptNo: r.receipt_no,
      status: r.status,
      reviewNote: r.review_note,
      reviewedAt: r.reviewed_at,
      hasReceipt: Number(r.attachment_count) > 0,
      createdAt: r.created_at,
    })),
    totals,
  });
}

/**
 * POST /driver/pin — the driver changes their own PIN.
 *
 * The current PIN is asked for again: a phone left unlocked on a seat is not
 * the driver. A wrong one answers 403, not 401, because the app reads a 401 as
 * "signed out". The new PIN must not be one everybody tries first, and is kept
 * only as a bcrypt hash. The driver is emailed that it changed — never the PIN
 * itself — which is how they would find out if it was not them.
 */
export async function changePin(req, res) {
  const { driverId, companyId } = req.driver;
  const currentPin = String(req.body?.currentPin ?? "").trim();
  const newPin = String(req.body?.newPin ?? "").trim();

  const [[d]] = await db.execute(
    "SELECT pin_hash, email, first_name, employee_no FROM drivers WHERE driver_id = ? AND company_id = ? LIMIT 1",
    [driverId, companyId]
  );
  if (!d?.pin_hash || !(await bcrypt.compare(currentPin, d.pin_hash))) {
    await recordAudit(asDriver(req), {
      module: "driver-app", action: "pin.change_failed", entityType: "driver", entityId: driverId,
      summary: `Wrong current PIN when driver ${req.driver.employeeNo || `#${driverId}`} tried to change their PIN`,
    });
    return res.status(403).json({ success: false, code: "PIN_WRONG", message: "Your current PIN isn't right." });
  }

  const weak = weakPinProblem(newPin);
  if (weak) return res.status(400).json({ success: false, code: "PIN_WEAK", message: weak });
  if (newPin === currentPin) {
    return res.status(400).json({ success: false, code: "PIN_SAME", message: "Your new PIN must be different from your current one." });
  }

  await db.execute("UPDATE drivers SET pin_hash = ? WHERE driver_id = ? AND company_id = ?", [await bcrypt.hash(newPin, 10), driverId, companyId]);
  await recordAudit(asDriver(req), {
    module: "driver-app", action: "pin.changed", entityType: "driver", entityId: driverId,
    summary: `Driver ${d.employee_no || `#${driverId}`} changed their PIN in the app`,
  });

  let emailed = false;
  if (d.email) {
    const mail = await sendDriverMail({
      to: d.email,
      ...driverPinChangedEmail({
        name: d.first_name, employeeNo: d.employee_no,
        when: new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" }),
      }),
    }).catch(() => null);
    emailed = Boolean(mail?.sent);
  }
  res.json({ success: true, data: { emailed } });
}

/* Driver routes sit outside the staff context chain, so audit rows are scoped explicitly. */
function asDriver(req) {
  req.context = { companyId: req.driver.companyId, branchId: null };
  req.user = { userId: null, email: `driver:${req.driver.employeeNo || `#${req.driver.driverId}`}` };
  return req;
}
