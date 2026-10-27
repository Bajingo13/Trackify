import db from "../../config/db.js";
import { checkClientRef } from "../chat/tripChat.service.js";
import { toRelative } from "../finance/receipts.storage.js";
import { openForDeliveryReport, settleForDeliveryReport } from "../support/exceptionSync.service.js";

/**
 * Delivery exceptions: what went wrong at the drop-off (migration 063).
 *
 *   delivered_with_issue   the load was handed over and the POD stands, but
 *                          it was short, damaged or the wrong item. Filed
 *                          after the delivery (the outbox keeps the order).
 *   not_delivered          the load was not handed over. No POD; the trip
 *                          stays on the road until the office decides —
 *                          reattempt, return or resolve — or the driver
 *                          delivers on a later attempt, which settles it.
 *
 * Every report is one exception in the Exceptions panel (exceptionSync), as
 * the alert types the system already lists. A report never changes the trip's
 * status by itself: the office decides what happens to a load.
 *
 * One open "not delivered" per trip, and never alongside a pause — a pause is
 * "I can't go on", a report is "I'm here and can't deliver"; the office should
 * not get both for one stop.
 */

export const REASONS = Object.freeze({
  short: { outcome: "delivered_with_issue", label: "Short delivery", photo: true },
  damaged: { outcome: "delivered_with_issue", label: "Damaged goods", photo: true },
  wrong_item: { outcome: "delivered_with_issue", label: "Wrong item", photo: false },
  refused: { outcome: "not_delivered", label: "Refused by the receiver", photo: false },
  absent: { outcome: "not_delivered", label: "Receiver absent or closed", photo: false },
  wrong_address: { outcome: "not_delivered", label: "Wrong address", photo: false },
  other: { outcome: "not_delivered", label: "Other reason", photo: false },
});
export const OUTCOMES = new Set(["delivered_with_issue", "not_delivered"]);

const MIN_NOTE = 3;
const MAX_NOTE = 1000;
const MAX_AGE_S = 48 * 60 * 60;
const MAX_QTY = 1_000_000;

const fail = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const missingTable = (e) => e?.code === "ER_NO_SUCH_TABLE";

const coordinate = (value, limit) => {
  const n = Number(value);
  return value !== undefined && value !== null && value !== "" && Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
};

function quantity(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > MAX_QTY) return NaN;
  return Math.round(n * 100) / 100;
}

/** What the phone sent, checked. Throws an error with `status` for anything the driver has to change. */
export function readReport(input = {}, photoCount = 0) {
  const outcome = String(input.outcome || "");
  if (!OUTCOMES.has(outcome)) throw fail(400, "Say whether the load was delivered.");
  const reason = String(input.reason || "");
  const spec = REASONS[reason];
  if (!spec || spec.outcome !== outcome) throw fail(400, "Choose what went wrong.");

  const note = String(input.note || "").trim();
  if (note.length < MIN_NOTE) throw fail(400, "Say what happened, in a few words.");
  if (note.length > MAX_NOTE) throw fail(400, `Keep it under ${MAX_NOTE} characters.`);

  let qtyExpected = null;
  let qtyDelivered = null;
  if (reason === "short") {
    qtyExpected = quantity(input.qtyExpected);
    qtyDelivered = quantity(input.qtyDelivered);
    if (qtyExpected == null || Number.isNaN(qtyExpected) || qtyExpected <= 0) throw fail(400, "Enter how many were expected.");
    if (qtyDelivered == null || Number.isNaN(qtyDelivered)) throw fail(400, "Enter how many were delivered.");
    if (qtyDelivered >= qtyExpected) throw fail(400, "A short delivery has fewer delivered than expected.");
  }
  if (spec.photo && photoCount === 0) throw fail(400, `${spec.label}: add a photo.`);

  const ageMs = Number(input.ageMs);
  const ageS = Number.isFinite(ageMs) ? Math.min(MAX_AGE_S, Math.max(0, Math.round(ageMs / 1000))) : 0;
  return {
    outcome, reason, label: spec.label, note, qtyExpected, qtyDelivered, ageS,
    lat: coordinate(input.lat, 90), lng: coordinate(input.lng, 180),
  };
}

const DRIVER_SELECT = `
  SELECT report_id AS id, trip_ticket_id AS tripId, outcome, reason, status,
         qty_expected AS qtyExpected, qty_delivered AS qtyDelivered,
         submitted_at AS submittedAt, resolved_at AS resolvedAt, resolution_note AS resolutionNote
    FROM delivery_reports`;

const shape = (row) => (row ? { ...row, reasonLabel: REASONS[row.reason]?.label || row.reason } : null);

/** The "not delivered" report waiting on the office for this trip, or null. */
export async function openNotDelivered(runner, tripId) {
  try {
    const [[row]] = await runner.execute(
      `${DRIVER_SELECT} WHERE trip_ticket_id = ? AND outcome = 'not_delivered' AND status = 'open'
        ORDER BY report_id DESC LIMIT 1`,
      [tripId]
    );
    return shape(row);
  } catch (e) {
    if (missingTable(e)) return null;
    throw e;
  }
}

/** What the Driver App shows about reports on a trip: the latest "not delivered", if any. */
export async function reportForDriver(runner, { tripId }) {
  try {
    const [[row]] = await runner.execute(
      `${DRIVER_SELECT} WHERE trip_ticket_id = ? AND outcome = 'not_delivered' ORDER BY report_id DESC LIMIT 1`,
      [tripId]
    );
    return shape(row);
  } catch (e) {
    if (missingTable(e)) return null;
    throw e;
  }
}

async function logHistory(conn, { companyId, branchId, tripId, status, action, remarks }) {
  await conn.execute(
    `INSERT INTO trip_status_history (company_id, branch_id, trip_ticket_id, from_status, to_status, action, remarks, changed_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    [companyId, branchId, tripId, status, status, action, String(remarks || "").slice(0, 500) || null]
  );
}

/**
 * File a report from the Driver App. Returns { report, duplicate, branchId }.
 * `files` are multer's; the caller discards them on a throw or a duplicate.
 */
export async function createForDriver({ driver, tripId, input = {}, files = [] }) {
  const clientRef = checkClientRef(input.clientRef);
  if (!clientRef) throw fail(400, "The report is missing its reference.");

  const [[existing]] = await db.execute(`${DRIVER_SELECT} WHERE driver_id = ? AND client_ref = ? LIMIT 1`, [driver.driverId, clientRef]);
  if (existing) return { report: shape(existing), duplicate: true };

  const r = readReport(input, files.length);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[trip]] = await conn.execute(
      `SELECT tt.trip_ticket_id AS id, tt.status, tt.branch_id AS branchId, tt.ticket_no AS ticketNo
         FROM trip_assignments ta
         JOIN trip_tickets tt ON tt.trip_ticket_id = ta.trip_ticket_id
        WHERE ta.trip_ticket_id = ? AND ta.driver_id = ? AND ta.is_current = TRUE
          AND tt.company_id = ? FOR UPDATE`,
      [tripId, driver.driverId, driver.companyId]
    );
    if (!trip) throw fail(404, "That trip isn't assigned to you.");

    if (r.outcome === "not_delivered") {
      if (trip.status !== "in_transit") {
        throw fail(409, "A delivery can only be reported as not delivered while the trip is on the road.");
      }
      const [[pause]] = await conn.execute(
        "SELECT status FROM trip_pauses WHERE trip_ticket_id = ? AND status IN ('pending','approved') LIMIT 1",
        [tripId]
      );
      if (pause) {
        throw fail(409, "This delivery has a pause open. Resume or withdraw it before reporting the delivery.", { code: "pause_open" });
      }
      if (await openNotDelivered(conn, tripId)) {
        throw fail(409, "This delivery is already reported as not delivered. The office is deciding what happens next.", { code: "report_open" });
      }
    } else {
      // after the delivery: the driver's own POD, with its photo, is on file
      if (!["delivered", "operationally_closed"].includes(trip.status)) {
        throw fail(409, "Confirm the delivery first, then report the problem with it.");
      }
      const [[pod]] = await conn.execute(
        "SELECT 1 AS ok FROM trip_pod WHERE trip_ticket_id = ? AND driver_id = ? AND photo_path IS NOT NULL LIMIT 1",
        [tripId, driver.driverId]
      );
      if (!pod) throw fail(409, "Only the driver who delivered this load can report a problem with it.");
    }

    const [ins] = await conn.execute(
      `INSERT INTO delivery_reports
         (company_id, branch_id, trip_ticket_id, driver_id, client_ref, outcome, reason,
          qty_expected, qty_delivered, note, captured_lat, captured_lng, captured_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW() - INTERVAL ? SECOND)`,
      [
        driver.companyId, Number(trip.branchId), tripId, driver.driverId, clientRef, r.outcome, r.reason,
        r.qtyExpected, r.qtyDelivered, r.note, r.lat, r.lng, r.ageS,
      ]
    );
    const reportId = ins.insertId;
    for (const file of files) {
      // eslint-disable-next-line no-await-in-loop
      await conn.execute(
        "INSERT INTO delivery_report_photos (report_id, photo_path, photo_mime, photo_size) VALUES (?, ?, ?, ?)",
        [reportId, toRelative(file.path), file.mimetype, file.size]
      );
    }
    await openForDeliveryReport(conn, {
      companyId: driver.companyId, branchId: Number(trip.branchId), tripId, reportId,
      outcome: r.outcome, reason: r.reason, reasonLabel: r.label, note: r.note, driverName: driver.name,
      qtyExpected: r.qtyExpected, qtyDelivered: r.qtyDelivered, latitude: r.lat, longitude: r.lng,
    });
    await logHistory(conn, {
      companyId: driver.companyId, branchId: Number(trip.branchId), tripId, status: trip.status,
      action: r.outcome === "not_delivered" ? "DELIVERY_NOT_COMPLETED" : "DELIVERY_ISSUE_REPORTED",
      remarks: `${r.outcome === "not_delivered" ? "Not delivered" : "Delivered with a problem"}: ${r.label} — reported by driver ${driver.name}`,
    });

    await conn.commit();
    const [[saved]] = await db.execute(`${DRIVER_SELECT} WHERE report_id = ?`, [reportId]);
    return { report: shape(saved), duplicate: false, branchId: Number(trip.branchId), ticketNo: trip.ticketNo };
  } catch (e) {
    await conn.rollback();
    // two copies arriving together: the loser answers with the winner
    if (e?.code === "ER_DUP_ENTRY") {
      const [[winner]] = await db.execute(`${DRIVER_SELECT} WHERE driver_id = ? AND client_ref = ? LIMIT 1`, [driver.driverId, clientRef]);
      if (winner) return { report: shape(winner), duplicate: true };
    }
    throw e;
  } finally {
    conn.release();
  }
}

/**
 * The load was delivered after all — by the driver on a later attempt, or
 * recorded by the office. Any "not delivered" still waiting on this trip is
 * settled with it. Runs inside the delivery's own transaction; a database
 * without migration 063 has nothing to settle.
 */
export async function settleOnDelivery(runner, { tripId, userId = null }) {
  let rows;
  try {
    [rows] = await runner.execute(
      `SELECT report_id AS id FROM delivery_reports
        WHERE trip_ticket_id = ? AND outcome = 'not_delivered' AND status IN ('open','reattempt')`,
      [tripId]
    );
  } catch (e) {
    if (missingTable(e)) return 0;
    throw e;
  }
  const note = "Delivered on a later attempt.";
  for (const { id } of rows) {
    // eslint-disable-next-line no-await-in-loop
    await runner.execute(
      `UPDATE delivery_reports SET status = 'resolved', resolved_by = ?, resolved_at = NOW(), resolution_note = ?
        WHERE report_id = ?`,
      [userId, note, id]
    );
    // eslint-disable-next-line no-await-in-loop
    await settleForDeliveryReport(runner, id, { userId, note });
  }
  return rows.length;
}
