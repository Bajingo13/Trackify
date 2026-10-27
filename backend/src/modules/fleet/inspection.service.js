import db from "../../config/db.js";
import { requiresPreTripInspection } from "../../shared/companySettings.js";
import { checkClientRef } from "../chat/tripChat.service.js";
import { toRelative } from "../finance/receipts.storage.js";
import { openForInspection, settleForInspection } from "../support/exceptionSync.service.js";

/**
 * Pre-trip vehicle inspections.
 *
 * Before a run starts the driver checks the truck item by item. The rule the
 * company set (migration 060, company_settings.require_pre_trip_inspection):
 *
 *   all OK                   → the trip may start
 *   a non-critical problem   → the trip may start; Fleet is told (a warning)
 *   a critical problem       → the trip may NOT start until the Fleet team
 *                              approves departure with a written reason
 *                              (critical exception in the Exceptions panel)
 *
 * The block only applies while the company requires inspections, so trips start
 * exactly as before until it is switched on. It is enforced here, on the
 * server, for the driver's Start and the office's Start alike — the phone also
 * shows it, but a phone is not where a rule like this can live.
 *
 * An inspection belongs to a trip and the vehicle on it. If the office swaps
 * the vehicle, the new one has not been inspected and needs its own.
 */

/*
 * The checklist, version 1. Each answer stores the item's wording as it was
 * asked, so changing this later never rewrites an old inspection.
 */
export const CHECKLIST_VERSION = 1;
export const CHECKLIST = Object.freeze([
  { key: "brakes", label: "Brakes", hint: "Pedal firm, parking brake holds, no warning light", critical: true },
  { key: "tyres", label: "Tyres", hint: "Pressure and tread, no cuts or bulges, wheel nuts tight", critical: true },
  { key: "lights", label: "Lights", hint: "Headlights, brake lights, turn signals and hazards all work", critical: true },
  { key: "fluids", label: "Fluids and leaks", hint: "Oil, coolant and fuel levels; nothing dripping under the truck", critical: false },
]);

const RESPONSES = new Set(["ok", "problem", "na"]);
const MAX_AGE_S = 48 * 60 * 60;
export const MIN_REASON = 5;

export const BLOCKED_MESSAGE =
  "A critical item failed the pre-trip inspection. The Fleet team must approve departure before this trip can start.";
export const REQUIRED_MESSAGE = "Complete the pre-trip inspection before starting this trip.";

const EMPTY_STATE = Object.freeze({ latest: null, blocked: false, satisfied: false, approved: false });

const fail = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });

/** Where this trip's inspections stand, for the vehicle now on it. */
export async function inspectionState(runner, { tripId, vehicleId }) {
  let rows;
  try {
    [rows] = await runner.execute(
      `SELECT inspection_id AS id, result, submitted_at AS submittedAt,
              departure_approved_at AS approvedAt, departure_approval_reason AS approvalReason
         FROM vehicle_inspections
        WHERE trip_ticket_id = ? AND vehicle_id = ?
        ORDER BY inspection_id`,
      [tripId, vehicleId]
    );
  } catch (e) {
    if (e?.code === "ER_NO_SUCH_TABLE") return { ...EMPTY_STATE };
    throw e;
  }
  const unapproved = rows.find((r) => r.result === "fail_critical" && !r.approvedAt);
  return {
    latest: rows.at(-1) || null,
    blocked: Boolean(unapproved),
    satisfied: rows.length > 0 && !unapproved,
    approved: rows.some((r) => r.result === "fail_critical" && r.approvedAt),
  };
}

/**
 * Whether this trip may start. null when it may; otherwise { code, message }
 * for a 409. Read on the caller's connection, inside its transaction.
 */
export async function startGate(runner, { companyId, tripId }) {
  if (!(await requiresPreTripInspection(companyId, runner))) return null;
  const [[asg]] = await runner.execute(
    "SELECT vehicle_id FROM trip_assignments WHERE trip_ticket_id = ? AND is_current = TRUE LIMIT 1",
    [tripId]
  );
  // nothing assigned to inspect: the trip's own rules decide
  if (!asg?.vehicle_id) return null;
  const state = await inspectionState(runner, { tripId, vehicleId: asg.vehicle_id });
  if (state.blocked) return { code: "inspection_failed", message: BLOCKED_MESSAGE };
  if (!state.satisfied) return { code: "inspection_required", message: REQUIRED_MESSAGE };
  return null;
}

/** What the Driver App needs about inspections on one trip, for the vehicle now on it. */
export async function inspectionForDriver(runner, { companyId, tripId }) {
  const required = await requiresPreTripInspection(companyId, runner);
  const [[asg]] = await runner.execute(
    "SELECT vehicle_id FROM trip_assignments WHERE trip_ticket_id = ? AND is_current = TRUE LIMIT 1",
    [tripId]
  );
  const state = asg?.vehicle_id ? await inspectionState(runner, { tripId, vehicleId: asg.vehicle_id }) : { ...EMPTY_STATE };
  return {
    required,
    checklistVersion: CHECKLIST_VERSION,
    checklist: CHECKLIST,
    result: state.latest?.result || null,
    blocked: state.blocked,
    satisfied: state.satisfied,
    approved: state.approved,
  };
}

/** The answers the phone sent, checked against the checklist. */
export function readAnswers(raw) {
  let list = raw;
  if (typeof raw === "string") {
    try { list = JSON.parse(raw); } catch { throw fail(400, "The inspection answers could not be read."); }
  }
  if (!Array.isArray(list)) throw fail(400, "The inspection answers could not be read.");

  const byKey = new Map();
  for (const a of list) {
    const key = String(a?.key || "");
    if (!CHECKLIST.some((c) => c.key === key)) throw fail(400, `"${key}" is not on the checklist.`);
    if (byKey.has(key)) throw fail(400, `"${key}" was answered twice.`);
    byKey.set(key, a);
  }

  return CHECKLIST.map((item) => {
    const a = byKey.get(item.key);
    if (!a) throw fail(400, `Answer every item: ${item.label} is missing.`);
    const response = String(a.response || "");
    if (!RESPONSES.has(response)) throw fail(400, `${item.label}: answer OK, Problem or N/A.`);
    if (response === "na" && item.critical) throw fail(400, `${item.label} must be checked; it cannot be N/A.`);
    const note = String(a.note || "").trim().slice(0, 500);
    if (response === "problem" && note.length < 3) throw fail(400, `${item.label}: say what is wrong.`);
    return { ...item, response, note: note || null };
  });
}

/** pass / fail_noncritical / fail_critical */
export function resultOf(answers) {
  const problems = answers.filter((a) => a.response === "problem");
  if (problems.some((a) => a.critical)) return "fail_critical";
  return problems.length ? "fail_noncritical" : "pass";
}

/** Which item each uploaded photo belongs to, in upload order. */
function readPhotoItems(raw, count) {
  if (!count) return [];
  let list = raw;
  if (typeof raw === "string") {
    try { list = JSON.parse(raw); } catch { list = null; }
  }
  // older builds tag each photo with its item; the simplified form sends one set
  // of photos for the whole report, with no tags
  if (list == null || raw === undefined) return Array(count).fill(null);
  if (!Array.isArray(list) || list.length !== count) throw fail(400, "Say which item each photo shows.");
  return list.map((k) => {
    const key = String(k || "");
    if (!key) return null;
    if (!CHECKLIST.some((c) => c.key === key)) throw fail(400, `A photo is for "${key}", which is not on the checklist.`);
    return key;
  });
}

const DRIVER_SELECT = `
  SELECT inspection_id AS id, trip_ticket_id AS tripId, vehicle_id AS vehicleId, result,
         review_status AS reviewStatus, submitted_at AS submittedAt,
         departure_approved_at AS approvedAt, departure_approval_reason AS approvalReason
    FROM vehicle_inspections`;

/**
 * File an inspection from the Driver App. Returns { inspection, duplicate }.
 * Throws an error with `status` for anything the driver has to change.
 * `files` are multer's; the caller discards them on a throw or a duplicate.
 */
export async function createForDriver({ driver, tripId, input, files = [] }) {
  const clientRef = checkClientRef(input.clientRef);
  if (!clientRef) throw fail(400, "The inspection is missing its reference.");

  const [[existing]] = await db.execute(`${DRIVER_SELECT} WHERE driver_id = ? AND client_ref = ? LIMIT 1`, [driver.driverId, clientRef]);
  if (existing) return { inspection: existing, duplicate: true };

  if (String(input.confirmed) !== "true") throw fail(400, "Confirm that you checked this vehicle yourself.");
  const answers = readAnswers(input.answers);
  const photoItems = readPhotoItems(input.photoItems, files.length);
  // A problem is reported with a photo — at least one for the report, which is
  // what Fleet decides from. (An older build tagged one per item; either passes.)
  const problems = answers.filter((a) => a.response === "problem");
  if (problems.length && files.length === 0) {
    throw fail(400, `${problems[0].label}: add a photo of the problem.`);
  }
  const result = resultOf(answers);
  const ageMs = Number(input.ageMs);
  const ageS = Number.isFinite(ageMs) ? Math.min(MAX_AGE_S, Math.max(0, Math.round(ageMs / 1000))) : 0;
  const lat = Number(input.lat);
  const lng = Number(input.lng);
  const notes = String(input.notes || "").trim().slice(0, 1000) || null;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[trip]] = await conn.execute(
      `SELECT ta.vehicle_id, tt.status, tt.branch_id, v.plate_no
         FROM trip_assignments ta
         JOIN trip_tickets tt ON tt.trip_ticket_id = ta.trip_ticket_id
         LEFT JOIN vehicles v ON v.vehicle_id = ta.vehicle_id
        WHERE ta.trip_ticket_id = ? AND ta.driver_id = ? AND ta.is_current = TRUE
          AND tt.company_id = ? FOR UPDATE`,
      [tripId, driver.driverId, driver.companyId]
    );
    if (!trip) throw fail(404, "That trip isn't assigned to you.");
    if (!trip.vehicle_id) throw fail(409, "No vehicle is assigned to this trip yet.");
    if (trip.status !== "released") throw fail(409, "The pre-trip inspection is done before the trip starts.");

    const state = await inspectionState(conn, { tripId, vehicleId: trip.vehicle_id });
    if (state.blocked) {
      throw fail(409, "This vehicle failed its inspection. The Fleet team has been told and must approve departure.", { code: "inspection_failed" });
    }

    const [ins] = await conn.execute(
      `INSERT INTO vehicle_inspections
         (company_id, branch_id, trip_ticket_id, vehicle_id, driver_id, client_ref, checklist_version,
          result, notes, captured_lat, captured_lng, captured_at, review_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW() - INTERVAL ? SECOND, ?)`,
      [
        driver.companyId, Number(trip.branch_id), tripId, trip.vehicle_id, driver.driverId, clientRef, CHECKLIST_VERSION,
        result, notes,
        Number.isFinite(lat) && Math.abs(lat) <= 90 ? lat : null,
        Number.isFinite(lng) && Math.abs(lng) <= 180 ? lng : null,
        ageS, result === "pass" ? "not_needed" : "pending",
      ]
    );
    const inspectionId = ins.insertId;

    for (const a of answers) {
      // eslint-disable-next-line no-await-in-loop
      await conn.execute(
        `INSERT INTO vehicle_inspection_items (inspection_id, item_key, label, critical, response, note)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [inspectionId, a.key, a.label, a.critical ? 1 : 0, a.response, a.note]
      );
    }
    for (let i = 0; i < files.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await conn.execute(
        `INSERT INTO vehicle_inspection_photos (inspection_id, item_key, photo_path, photo_mime, photo_size)
         VALUES (?, ?, ?, ?, ?)`,
        [inspectionId, photoItems[i], toRelative(files[i].path), files[i].mimetype, files[i].size]
      );
    }

    if (result !== "pass") {
      await openForInspection(conn, {
        companyId: driver.companyId,
        branchId: Number(trip.branch_id),
        tripId,
        inspectionId,
        critical: result === "fail_critical",
        problems: answers.filter((a) => a.response === "problem"),
        driverName: driver.name,
        plateNo: trip.plate_no || null,
        latitude: Number.isFinite(lat) ? lat : null,
        longitude: Number.isFinite(lng) ? lng : null,
      });
    }

    await conn.commit();
    const [[saved]] = await db.execute(`${DRIVER_SELECT} WHERE inspection_id = ?`, [inspectionId]);
    return { inspection: saved, duplicate: false, branchId: Number(trip.branch_id) };
  } catch (e) {
    await conn.rollback();
    // two copies arriving together: the loser answers with the winner
    if (e?.code === "ER_DUP_ENTRY") {
      const [[winner]] = await db.execute(`${DRIVER_SELECT} WHERE driver_id = ? AND client_ref = ? LIMIT 1`, [driver.driverId, clientRef]);
      if (winner) return { inspection: winner, duplicate: true };
    }
    throw e;
  } finally {
    conn.release();
  }
}

/* ---------------------------------------------------------------- */
/* The Fleet team                                                   */
/* ---------------------------------------------------------------- */

const OFFICE_SELECT = `
  SELECT i.inspection_id AS id, i.trip_ticket_id AS tripId, tt.ticket_no AS ticketNo, tt.status AS tripStatus,
         i.vehicle_id AS vehicleId, v.plate_no AS plateNo, i.driver_id AS driverId,
         CONCAT_WS(' ', d.first_name, d.last_name) AS driverName,
         i.result, i.notes, i.review_status AS reviewStatus, i.review_note AS reviewNote, i.reviewed_at AS reviewedAt,
         i.departure_approved_at AS approvedAt, i.departure_approval_reason AS approvalReason,
         i.captured_at AS capturedAt, i.submitted_at AS submittedAt,
         i.captured_lat AS lat, i.captured_lng AS lng
    FROM vehicle_inspections i
    JOIN trip_tickets tt ON tt.trip_ticket_id = i.trip_ticket_id
    LEFT JOIN vehicles v ON v.vehicle_id = i.vehicle_id
    LEFT JOIN drivers d ON d.driver_id = i.driver_id`;

/** The inspections Fleet looks at: those waiting for them first, or all. */
export async function listForOffice({ companyId, status = "pending", limit = 100 }) {
  const where = ["i.company_id = ?"];
  const params = [companyId];
  if (status === "pending") where.push("i.review_status = 'pending'");
  else if (status === "failed") where.push("i.result <> 'pass'");
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 200);
  const [rows] = await db.execute(
    `${OFFICE_SELECT} WHERE ${where.join(" AND ")}
      ORDER BY (i.result = 'fail_critical' AND i.departure_approved_at IS NULL) DESC, i.submitted_at DESC
      LIMIT ${lim}`,
    params
  );
  return rows;
}

/** One inspection with its answers and photos, or null. */
export async function getForOffice({ companyId, id }) {
  const [[row]] = await db.execute(`${OFFICE_SELECT} WHERE i.inspection_id = ? AND i.company_id = ? LIMIT 1`, [id, companyId]);
  if (!row) return null;
  const [items] = await db.execute(
    `SELECT item_key AS \`key\`, label, critical, response, note
       FROM vehicle_inspection_items WHERE inspection_id = ? ORDER BY item_id`,
    [id]
  );
  const [photos] = await db.execute(
    "SELECT photo_id AS id, item_key AS itemKey FROM vehicle_inspection_photos WHERE inspection_id = ? ORDER BY photo_id",
    [id]
  );
  return { ...row, items: items.map((i) => ({ ...i, critical: Boolean(i.critical) })), photos };
}

/** The stored file for one of an inspection's photos, or null. */
export async function photoForOffice({ companyId, id, photoId }) {
  const [[p]] = await db.execute(
    `SELECT p.photo_path AS path, p.photo_mime AS mime
       FROM vehicle_inspection_photos p
       JOIN vehicle_inspections i ON i.inspection_id = p.inspection_id
      WHERE p.photo_id = ? AND p.inspection_id = ? AND i.company_id = ? LIMIT 1`,
    [photoId, id, companyId]
  );
  return p || null;
}

/**
 * Fleet lets a trip go after a critical failure — the defect was fixed, or is
 * judged safe — with the reason on record. The trip can then start.
 */
export async function approveDeparture({ companyId, id, userId, reason }) {
  const why = String(reason || "").trim();
  if (why.length < MIN_REASON) throw fail(400, "Give the reason departure is approved.");

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[row]] = await conn.execute(
      `SELECT i.inspection_id, i.result, i.departure_approved_at, i.trip_ticket_id, i.driver_id, i.branch_id, tt.status
         FROM vehicle_inspections i
         JOIN trip_tickets tt ON tt.trip_ticket_id = i.trip_ticket_id
        WHERE i.inspection_id = ? AND i.company_id = ? FOR UPDATE`,
      [id, companyId]
    );
    if (!row) throw fail(404, "Inspection not found.");
    if (row.result !== "fail_critical") throw fail(409, "Only a failed critical inspection needs departure approved.");
    if (row.departure_approved_at) throw fail(409, "Departure was already approved for this inspection.");

    await conn.execute(
      `UPDATE vehicle_inspections
          SET departure_approved_by = ?, departure_approved_at = NOW(), departure_approval_reason = ?,
              review_status = 'reviewed', reviewed_by = ?, reviewed_at = NOW(), review_note = COALESCE(review_note, ?)
        WHERE inspection_id = ?`,
      [userId, why.slice(0, 1000), userId, why.slice(0, 1000), id]
    );
    await settleForInspection(conn, id, { userId, note: `Departure approved: ${why}` });
    await conn.commit();
    return { tripId: row.trip_ticket_id, driverId: row.driver_id, branchId: row.branch_id };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/** Fleet has looked at an inspection that did not hold the trip (a non-critical problem). */
export async function markReviewed({ companyId, id, userId, note }) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[row]] = await conn.execute(
      "SELECT inspection_id, result, review_status FROM vehicle_inspections WHERE inspection_id = ? AND company_id = ? FOR UPDATE",
      [id, companyId]
    );
    if (!row) throw fail(404, "Inspection not found.");
    if (row.result === "fail_critical") throw fail(409, "A failed critical inspection is settled by approving departure.");
    if (row.review_status !== "pending") throw fail(409, "This inspection has no review waiting.");
    const text = String(note || "").trim().slice(0, 1000) || null;
    await conn.execute(
      "UPDATE vehicle_inspections SET review_status = 'reviewed', reviewed_by = ?, reviewed_at = NOW(), review_note = ? WHERE inspection_id = ?",
      [userId, text, id]
    );
    await settleForInspection(conn, id, { userId, note: text || "Reviewed by Fleet." });
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
