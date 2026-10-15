import crypto from "node:crypto";
import db from "../../config/db.js";
import { publish, publishToDriver } from "../../realtime/hub.js";
import { toRelative } from "../finance/receipts.storage.js";
import { appendStaffNote, createTicketTx, setTicketStatus, ticketNo } from "./support.service.js";
import { notifyDriver } from "./push.service.js";
import { openForPause, settleForPause } from "./exceptionSync.service.js";

/**
 * Pause requests.
 *
 * A driver who meets a legitimate interruption asks the office to pause the
 * delivery, with a reason, a description and photographs. The office approves
 * or declines; while an approved pause is open the delivery is shown as paused,
 * with the reason, instead of as a truck that has gone quiet.
 *
 * The trip's own status is never touched. A pause is a record laid over an
 * in-transit trip, so every screen and report that reads trip statuses keeps
 * meaning what it meant. Every pause files a support ticket with it, so the
 * conversation, the history and the tracking are the ones Help & Support
 * already has.
 *
 * What a customer is shown is deliberately less than what the office is: the
 * reason in plain words and the office's own message — never the driver's
 * description, their photographs, or where they are.
 */

export const REASONS = ["breakdown", "emergency", "incident", "delay", "other"];
export const REASON_LABEL = {
  breakdown: "Vehicle breakdown",
  emergency: "Emergency",
  incident: "Unexpected incident",
  delay: "Delivery delay",
  other: "Other concern",
};
export const STATUS_LABEL = {
  pending: "Waiting for review",
  approved: "Approved",
  declined: "Declined",
  resumed: "Resumed",
  cancelled: "Withdrawn",
};

/** What a request about each kind of reason is filed under in Help & Support. */
const TICKET_CATEGORY = { breakdown: "vehicle", emergency: "safety", incident: "safety", delay: "trip", other: "other" };
/** These reasons put the office on notice: the request is marked urgent. */
const URGENT = new Set(["breakdown", "emergency", "incident"]);

/** What the customer reads when the office has not written something of its own. */
const CUSTOMER_DEFAULT = {
  breakdown: "The vehicle has had a mechanical problem. The driver is dealing with it, and the delivery will continue as soon as it is safe to.",
  emergency: "The driver has had to stop because of an emergency. The delivery will continue as soon as it is safe to.",
  incident: "The delivery has been interrupted by an unexpected incident on the road. It will continue as soon as it is safe to.",
  delay: "The delivery is delayed by conditions on the road, such as traffic, weather or a closure.",
  other: "The delivery has been paused for a reason the driver has reported to the office.",
};

const MAX_DESCRIPTION = 2000;
const MIN_DESCRIPTION = 10;
const MAX_NOTE = 500;
const MAX_CUSTOMER_MESSAGE = 300;
const LINK_DAYS = 30;

const clean = (value) => String(value ?? "").replace(/\r\n?/g, "\n").trim();

/** A device-chosen id that makes a replayed send harmless. Anything else is ignored. */
const checkClientRef = (value) => (/^[A-Za-z0-9_-]{8,64}$/.test(String(value ?? "")) ? String(value) : null);

const coordinate = (value, limit) => {
  const n = Number(value);
  return value !== "" && value != null && Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
};

/* ---------------------------------------------------------------- */
/* Reading                                                          */
/* ---------------------------------------------------------------- */

const PAUSE_SELECT = `
  SELECT p.pause_id AS id, p.ticket_id AS ticketId, p.trip_ticket_id AS tripId, tt.ticket_no AS tripNo,
         p.company_id AS companyId, p.branch_id AS branchId, p.driver_id AS driverId, p.driver_name AS driverName,
         p.reason, p.description, p.latitude, p.longitude, p.status,
         p.requested_at AS requestedAt, p.reviewed_at AS reviewedAt, p.reviewed_by_name AS reviewedByName,
         p.review_note AS reviewNote, p.customer_message AS customerMessage,
         p.resumed_at AS resumedAt, p.resumed_by AS resumedBy
    FROM trip_pauses p
    JOIN trip_tickets tt ON tt.trip_ticket_id = p.trip_ticket_id`;

const minutesBetween = (from, to) => {
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? Math.round((b - a) / 60000) : null;
};

/** One pause, as the driver or the office is shown it. */
function pauseView(row, photos = []) {
  const started = row.reviewedAt && (row.status === "approved" || row.status === "resumed") ? row.reviewedAt : null;
  return {
    id: row.id,
    ticketId: row.ticketId,
    ticketNo: row.ticketId ? ticketNo(row.ticketId) : null,
    tripId: row.tripId,
    tripNo: row.tripNo,
    driverName: row.driverName,
    status: row.status,
    statusLabel: STATUS_LABEL[row.status] || row.status,
    reason: row.reason,
    reasonLabel: REASON_LABEL[row.reason] || row.reason,
    description: row.description,
    latitude: row.latitude == null ? null : Number(row.latitude),
    longitude: row.longitude == null ? null : Number(row.longitude),
    requestedAt: row.requestedAt,
    reviewedAt: row.reviewedAt,
    reviewedByName: row.reviewedByName,
    reviewNote: row.reviewNote,
    customerMessage: row.customerMessage,
    resumedAt: row.resumedAt,
    resumedBy: row.resumedBy,
    // how long the delivery was (or has so far been) held, from approval
    pausedMinutes: started ? minutesBetween(started, row.resumedAt || new Date()) : null,
    photos,
  };
}

/** Where the evidence is, by number. The path on disk never leaves the server. */
async function photosOf(pauseId) {
  const [rows] = await db.execute(
    "SELECT photo_id AS id, photo_mime AS mime, photo_size AS size, created_at AS createdAt FROM trip_pause_photos WHERE pause_id = ? ORDER BY photo_id",
    [pauseId]
  );
  return rows;
}

/** The short form: enough for a badge on a trip, a list or a live event. */
const summary = (row) => ({
  id: row.id,
  status: row.status,
  reason: row.reason,
  reasonLabel: REASON_LABEL[row.reason] || row.reason,
  requestedAt: row.requestedAt,
  reviewedAt: row.reviewedAt,
});

function announce(pause) {
  publish(pause.companyId, pause.branchId, { type: "trip:pause", tripId: pause.tripId, pause: summary(pause) });
}

/** What the office is told, in the thread, about each turn a pause takes. */
async function logHistory(conn, { companyId, branchId, tripId, action, remarks }) {
  await conn.execute(
    `INSERT INTO trip_status_history (company_id, branch_id, trip_ticket_id, from_status, to_status, action, remarks, changed_by)
     VALUES (?, ?, ?, 'in_transit', 'in_transit', ?, ?, NULL)`,
    [companyId, branchId, tripId, action, String(remarks || "").slice(0, 500) || null]
  );
}

/* ---------------------------------------------------------------- */
/* Driver                                                           */
/* ---------------------------------------------------------------- */

/**
 * Ask for a pause. Returns { pause, duplicate } or { error, status }.
 *
 * `files` are already on disk, put there by the upload middleware; the caller
 * removes them if this answers with an error or a duplicate.
 */
export async function createForDriver({ driver, tripId, input, files = [] }) {
  const reason = REASONS.includes(input.reason) ? input.reason : null;
  if (!reason) return { status: 400, error: "Choose what happened." };
  const description = clean(input.description);
  if (description.length < MIN_DESCRIPTION) {
    return { status: 400, error: "Describe what happened, in a sentence or two, so the office can judge it." };
  }
  if (description.length > MAX_DESCRIPTION) {
    return { status: 400, error: `Keep the description under ${MAX_DESCRIPTION} characters.` };
  }
  // Evidence is what lets the office approve without a phone call. An emergency
  // is the one case where stopping to take photographs is the wrong ask.
  if (reason !== "emergency" && files.length === 0) {
    return { status: 400, error: "Add at least one photo of the problem, so the office can see it." };
  }

  const clientRef = checkClientRef(input.clientRef);
  // The time that counts is when the driver pressed Send, not when a request
  // parked on a phone out of signal finally reached the server — a delay that
  // began at 08:00 must not read as one that began at 09:40. The phone's clock
  // is only believed within a day and not in the future; otherwise the server's own.
  const claimed = new Date(input.requestedAt).getTime();
  const now = Date.now();
  const requestedAt = Number.isFinite(claimed) && claimed <= now + 60_000 && claimed >= now - 24 * 3600 * 1000
    ? new Date(claimed)
    : null;
  if (clientRef) {
    const [[existing]] = await db.execute(
      "SELECT pause_id AS id FROM trip_pauses WHERE driver_id = ? AND client_ref = ? LIMIT 1",
      [driver.driverId, clientRef]
    );
    if (existing) return { pause: await getForDriver({ driver, id: existing.id }), duplicate: true };
  }

  const [[trip]] = await db.execute(
    `SELECT tt.trip_ticket_id AS id, tt.branch_id AS branchId, tt.status, tt.ticket_no AS tripNo
       FROM trip_assignments ta
       JOIN trip_tickets tt ON tt.trip_ticket_id = ta.trip_ticket_id
      WHERE ta.driver_id = ? AND ta.is_current = TRUE AND tt.company_id = ? AND tt.trip_ticket_id = ? LIMIT 1`,
    [driver.driverId, driver.companyId, tripId]
  );
  if (!trip) return { status: 404, error: "That trip isn't assigned to you." };
  if (trip.status !== "in_transit") {
    return { status: 409, error: "You can ask to pause a delivery once it is on the road." };
  }

  const [[open]] = await db.execute(
    "SELECT pause_id AS id, status FROM trip_pauses WHERE trip_ticket_id = ? AND status IN ('pending','approved') LIMIT 1",
    [trip.id]
  );
  if (open) {
    return {
      status: 409,
      error: open.status === "approved"
        ? "This delivery is already paused. Resume it before asking again."
        : "You already have a pause request waiting on this delivery.",
    };
  }

  const conn = await db.getConnection();
  let pauseId;
  let ticketId;
  try {
    await conn.beginTransaction();
    const label = REASON_LABEL[reason];
    ({ id: ticketId } = await createTicketTx(conn, {
      driver,
      branchId: trip.branchId,
      tripId: trip.id,
      category: TICKET_CATEGORY[reason],
      priority: URGENT.has(reason) ? "urgent" : "normal",
      subject: `Pause request: ${label} (${trip.tripNo})`.slice(0, 120),
      body: description,
    }));
    const [created] = await conn.execute(
      `INSERT INTO trip_pauses
         (company_id, branch_id, trip_ticket_id, driver_id, driver_name, ticket_id, reason, description,
          latitude, longitude, client_ref, requested_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP(3)))`,
      [
        driver.companyId, trip.branchId, trip.id, driver.driverId, driver.name.slice(0, 150), ticketId, reason, description,
        coordinate(input.lat, 90), coordinate(input.lng, 180), clientRef, requestedAt,
      ]
    );
    pauseId = created.insertId;
    await openForPause(conn, {
      companyId: driver.companyId, branchId: trip.branchId, tripId: trip.id, pauseId, reason, reasonLabel: label,
      driverName: driver.name, description, latitude: coordinate(input.lat, 90), longitude: coordinate(input.lng, 180),
    });
    for (const file of files) {
      // eslint-disable-next-line no-await-in-loop
      await conn.execute(
        "INSERT INTO trip_pause_photos (pause_id, photo_path, photo_mime, photo_size) VALUES (?, ?, ?, ?)",
        [pauseId, toRelative(file.path), file.mimetype, file.size]
      );
    }
    await logHistory(conn, {
      companyId: driver.companyId, branchId: trip.branchId, tripId: trip.id, action: "PAUSE_REQUESTED",
      remarks: `${label} — requested by driver ${driver.name}`,
    });
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    if (err.code === "ER_DUP_ENTRY" && clientRef) {
      const [[existing]] = await db.execute(
        "SELECT pause_id AS id FROM trip_pauses WHERE driver_id = ? AND client_ref = ? LIMIT 1",
        [driver.driverId, clientRef]
      );
      if (existing) return { pause: await getForDriver({ driver, id: existing.id }), duplicate: true };
    }
    throw err;
  } finally {
    conn.release();
  }

  const pause = await getForDriver({ driver, id: pauseId });
  publish(driver.companyId, trip.branchId, {
    type: "support:ticket",
    ticket: {
      id: ticketId, ticketNo: ticketNo(ticketId), subject: `Pause request: ${REASON_LABEL[reason]} (${trip.tripNo})`,
      category: TICKET_CATEGORY[reason], priority: URGENT.has(reason) ? "urgent" : "normal", status: "open",
      driverName: driver.name, pause: true,
    },
  });
  announce({ ...pause, companyId: driver.companyId, branchId: trip.branchId });
  return { pause, duplicate: false };
}

/** One of the driver's own pauses, with its photographs. */
export async function getForDriver({ driver, id }) {
  const [[row]] = await db.execute(
    `${PAUSE_SELECT} WHERE p.pause_id = ? AND p.driver_id = ? AND p.company_id = ? LIMIT 1`,
    [id, driver.driverId, driver.companyId]
  );
  return row ? pauseView(row, await photosOf(row.id)) : null;
}

/** The driver's history: every pause they have asked for, newest first. */
export async function listForDriver({ driver }) {
  const [rows] = await db.execute(
    `${PAUSE_SELECT} WHERE p.driver_id = ? AND p.company_id = ? ORDER BY p.pause_id DESC LIMIT 100`,
    [driver.driverId, driver.companyId]
  );
  return rows.map((r) => pauseView(r));
}

/** The pause on a trip that is waiting or in force, for the banner on the trip screen. */
export async function activeForDriverTrip({ driver, tripId }) {
  const [[row]] = await db.execute(
    `${PAUSE_SELECT}
      WHERE p.trip_ticket_id = ? AND p.driver_id = ? AND p.company_id = ? AND p.status IN ('pending','approved')
      ORDER BY p.pause_id DESC LIMIT 1`,
    [tripId, driver.driverId, driver.companyId]
  );
  return row ? pauseView(row) : null;
}

/** A photograph on the driver's own pause, by number. */
export async function photoForDriver({ driver, pauseId, photoId }) {
  const [[row]] = await db.execute(
    `SELECT ph.photo_path AS path, ph.photo_mime AS mime
       FROM trip_pause_photos ph JOIN trip_pauses p ON p.pause_id = ph.pause_id
      WHERE ph.photo_id = ? AND ph.pause_id = ? AND p.driver_id = ? AND p.company_id = ? LIMIT 1`,
    [photoId, pauseId, driver.driverId, driver.companyId]
  );
  return row || null;
}

/**
 * End a pause the driver started: withdraw one still waiting, or resume a
 * delivery that was paused. Returns { pause } or { error, status }.
 */
async function endAsDriver({ driver, tripId, expect, status, message, ticketStatus, historyAction }) {
  const conn = await db.getConnection();
  let found;
  try {
    await conn.beginTransaction();
    const [[row]] = await conn.execute(
      `SELECT pause_id AS id, ticket_id AS ticketId, branch_id AS branchId, status
         FROM trip_pauses
        WHERE trip_ticket_id = ? AND driver_id = ? AND company_id = ? AND status IN ('pending','approved')
        ORDER BY pause_id DESC LIMIT 1 FOR UPDATE`,
      [tripId, driver.driverId, driver.companyId]
    );
    if (!row) { await conn.rollback(); return { status: 404, error: "There is no pause on this delivery." }; }
    if (row.status !== expect) {
      await conn.rollback();
      return {
        status: 409,
        error: expect === "pending"
          ? "The office has already answered, so it can't be withdrawn. Resume the delivery instead."
          : "The office hasn't approved this pause yet. Withdraw it, or wait for their answer.",
      };
    }
    await conn.execute(
      `UPDATE trip_pauses SET status = ?, resumed_at = NOW(3), resumed_by = 'driver' WHERE pause_id = ?`,
      [status, row.id]
    );
    await settleForPause(conn, row.id, {
      status,
      note: status === "resumed" ? `Delivery resumed by driver ${driver.name}.` : `Withdrawn by driver ${driver.name} before it was answered.`,
    });
    if (row.ticketId) {
      await conn.execute(
        `INSERT INTO support_messages (ticket_id, sender_kind, sender_driver_id, sender_name, body)
         VALUES (?, 'driver', ?, ?, ?)`,
        [row.ticketId, driver.driverId, driver.name.slice(0, 150), message]
      );
      await setTicketStatus(conn, row.ticketId, ticketStatus);
    }
    await logHistory(conn, {
      companyId: driver.companyId, branchId: row.branchId, tripId, action: historyAction,
      remarks: `${message} (driver ${driver.name})`,
    });
    await conn.commit();
    found = row;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  const pause = await getForDriver({ driver, id: found.id });
  announce({ ...pause, companyId: driver.companyId, branchId: found.branchId });
  return { pause };
}

export const withdrawAsDriver = ({ driver, tripId }) =>
  endAsDriver({
    driver, tripId, expect: "pending", status: "cancelled",
    message: "I withdrew this pause request.", ticketStatus: "closed", historyAction: "PAUSE_WITHDRAWN",
  });

export const resumeAsDriver = ({ driver, tripId }) =>
  endAsDriver({
    driver, tripId, expect: "approved", status: "resumed",
    message: "I'm back on the road. The delivery has resumed.", ticketStatus: "resolved", historyAction: "PAUSE_RESUMED",
  });

/* ---------------------------------------------------------------- */
/* Staff                                                            */
/* ---------------------------------------------------------------- */

/** The pause behind a request, with its photographs — null when it is an ordinary request. */
export async function detailForTicket({ companyId, branchId, ticketId }) {
  const [[row]] = await db.execute(
    `${PAUSE_SELECT} WHERE p.ticket_id = ? AND p.company_id = ? AND p.branch_id = ? LIMIT 1`,
    [ticketId, companyId, branchId]
  );
  return row ? pauseView(row, await photosOf(row.id)) : null;
}

/** A photograph on a pause in the branch being operated in. */
export async function photoForStaff({ companyId, branchId, ticketId, photoId }) {
  const [[row]] = await db.execute(
    `SELECT ph.photo_path AS path, ph.photo_mime AS mime
       FROM trip_pause_photos ph JOIN trip_pauses p ON p.pause_id = ph.pause_id
      WHERE ph.photo_id = ? AND p.ticket_id = ? AND p.company_id = ? AND p.branch_id = ? LIMIT 1`,
    [photoId, ticketId, companyId, branchId]
  );
  return row || null;
}

/** Lock a branch's pause by its ticket, inside the caller's transaction. */
async function lockForStaff(conn, { companyId, branchId, ticketId }) {
  const [[row]] = await conn.execute(
    `SELECT pause_id AS id, ticket_id AS ticketId, trip_ticket_id AS tripId, status, reason
       FROM trip_pauses WHERE ticket_id = ? AND company_id = ? AND branch_id = ? FOR UPDATE`,
    [ticketId, companyId, branchId]
  );
  return row || null;
}

async function reply(conn, { context, user, ticketId, body }) {
  return appendStaffNote(conn, { ticketId, user, body, companyId: context.companyId, branchId: context.branchId });
}

/**
 * The office's answer. `decision` is "approve", "decline" or "resume".
 * Returns { pause } or { error, status }.
 */
async function decide({ context, user, ticketId, input, decision }) {
  const { companyId, branchId } = context;
  const note = clean(input.note);
  const customerMessage = clean(input.customerMessage);

  if (decision === "decline" && note.length < 3) {
    return { status: 400, error: "Tell the driver why, so they know what to do next." };
  }
  if (note.length > MAX_NOTE) return { status: 400, error: `Keep the note under ${MAX_NOTE} characters.` };
  if (customerMessage.length > MAX_CUSTOMER_MESSAGE) {
    return { status: 400, error: `Keep the message for the customer under ${MAX_CUSTOMER_MESSAGE} characters.` };
  }

  const name = String(user.name || user.email || "Support").slice(0, 150);
  const conn = await db.getConnection();
  let locked;
  let message;
  try {
    await conn.beginTransaction();
    locked = await lockForStaff(conn, { companyId, branchId, ticketId });
    if (!locked) { await conn.rollback(); return { status: 404, error: "That pause request isn't in this branch." }; }

    const needs = decision === "resume" ? "approved" : "pending";
    if (locked.status !== needs) {
      await conn.rollback();
      const now = STATUS_LABEL[locked.status]?.toLowerCase() || locked.status;
      return {
        status: 409,
        error: decision === "resume"
          ? `This delivery isn't paused (${now}).`
          : `This request has already been answered (${now}).`,
      };
    }

    if (decision === "approve") {
      await conn.execute(
        `UPDATE trip_pauses
            SET status = 'approved', reviewed_at = NOW(3), reviewed_by_user_id = ?, reviewed_by_name = ?,
                review_note = ?, customer_message = ?
          WHERE pause_id = ?`,
        [user.userId, name, note || null, customerMessage || null, locked.id]
      );
      await settleForPause(conn, locked.id, { status: "approved", userId: user.userId });
      message = await reply(conn, {
        context, user, ticketId,
        body: `Your pause request was approved.${note ? ` ${note}` : ""} Tap Resume when you are back on the road.`,
      });
      await setTicketStatus(conn, ticketId, "in_progress");
    } else if (decision === "decline") {
      await conn.execute(
        `UPDATE trip_pauses
            SET status = 'declined', reviewed_at = NOW(3), reviewed_by_user_id = ?, reviewed_by_name = ?, review_note = ?
          WHERE pause_id = ?`,
        [user.userId, name, note, locked.id]
      );
      await settleForPause(conn, locked.id, { status: "declined", userId: user.userId, note: `Pause request declined by ${name}: ${note}` });
      message = await reply(conn, {
        context, user, ticketId, body: `Your pause request was declined. ${note}`,
      });
      await setTicketStatus(conn, ticketId, "resolved");
    } else {
      await conn.execute(
        `UPDATE trip_pauses SET status = 'resumed', resumed_at = NOW(3), resumed_by = 'staff' WHERE pause_id = ?`,
        [locked.id]
      );
      await settleForPause(conn, locked.id, {
        status: "resumed", userId: user.userId,
        note: `Delivery resumed — the pause was ended by ${name}${note ? `: ${note}` : "."}`,
      });
      message = await reply(conn, {
        context, user, ticketId,
        body: `The pause has been ended by the office.${note ? ` ${note}` : ""} Please continue the delivery.`,
      });
      await setTicketStatus(conn, ticketId, "resolved");
    }

    await logHistory(conn, {
      companyId, branchId, tripId: locked.tripId,
      action: decision === "approve" ? "PAUSE_APPROVED" : decision === "decline" ? "PAUSE_DECLINED" : "PAUSE_RESUMED",
      remarks: `${REASON_LABEL[locked.reason]} — ${decision} by ${name}${note ? `: ${note}` : ""}`,
    });
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  const pause = await detailForTicket({ companyId, branchId, ticketId });
  announce({ ...pause, companyId, branchId });
  // the driver's run card ("Pause requested" -> "Paused") follows at once
  publishToDriver(companyId, locked.driverId, { type: "trip:pause", tripId: pause?.tripId, status: pause?.status });
  void notifyDriver({
    companyId, driverId: locked.driverId, tag: `pause-${locked.id}`,
    title: decision === "approve" ? "Pause request approved" : decision === "decline" ? "Pause request declined" : "Delivery pause ended",
    body: decision === "approve" ? "Open Trackify, and tap Paused when you are back on the road."
      : decision === "decline" ? "The office wrote you a reason. Open Trackify to read it."
        : "The office ended the pause. Please continue the delivery.",
  });
  publish(companyId, branchId, {
    type: "support:message",
    ticketId,
    message: { id: message.id, ticketId, senderKind: "staff", senderName: message.senderName, body: message.body, createdAt: new Date() },
  });
  return { pause };
}

export const approve = (args) => decide({ ...args, decision: "approve" });
export const decline = (args) => decide({ ...args, decision: "decline" });
export const resumeAsStaff = (args) => decide({ ...args, decision: "resume" });

/**
 * Pauses waiting or in force on the given trips, one per trip, for the live
 * tracking board — so a truck that is stopped for a reason is not drawn as one
 * that has gone quiet.
 */
export async function activeByTrip({ companyId, branchId, tripIds }) {
  const ids = [...new Set(tripIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) return new Map();
  const [rows] = await db.execute(
    `${PAUSE_SELECT}
      WHERE p.company_id = ? AND p.branch_id = ? AND p.status IN ('pending','approved')
        AND p.trip_ticket_id IN (${ids.map(() => "?").join(",")})
      ORDER BY p.pause_id ASC`,
    [companyId, branchId, ...ids]
  );
  const map = new Map();
  // ascending, so the newest for a trip is the one left standing
  for (const row of rows) map.set(row.tripId, { ...summary(row), ticketId: row.ticketId, ticketNo: row.ticketId ? ticketNo(row.ticketId) : null });
  return map;
}

/**
 * A delivery that is finished (or called off) ends any pause on it. Approved
 * pauses count as resumed — by the delivery — and ones still waiting are
 * withdrawn; either way the ticket is settled. Best effort: it must never
 * fail the delivery that triggered it.
 */
export async function endForTrip(tripId) {
  try {
    const [rows] = await db.execute(
      `${PAUSE_SELECT} WHERE p.trip_ticket_id = ? AND p.status IN ('pending','approved')`,
      [tripId]
    );
    for (const row of rows) {
      const next = row.status === "approved" ? "resumed" : "cancelled";
      // eslint-disable-next-line no-await-in-loop
      await db.execute(
        "UPDATE trip_pauses SET status = ?, resumed_at = NOW(3), resumed_by = 'delivery' WHERE pause_id = ? AND status IN ('pending','approved')",
        [next, row.id]
      );
      // eslint-disable-next-line no-await-in-loop
      await settleForPause(db, row.id, {
        status: next,
        note: next === "resumed" ? "The delivery was completed, which ended the pause." : "The delivery finished while the request was still waiting.",
      });
      if (row.ticketId) {
        // eslint-disable-next-line no-await-in-loop
        await setTicketStatus(db, row.ticketId, next === "resumed" ? "resolved" : "closed");
      }
      announce({ ...row, status: next });
    }
  } catch (err) {
    console.error(`[pause] could not close pauses for trip ${tripId}: ${err?.code || err?.name || "error"}`);
  }
}

/* ---------------------------------------------------------------- */
/* The customer's link                                              */
/* ---------------------------------------------------------------- */

/** An active link for a trip in this branch — the one already made, or a new one. */
export async function linkForTrip({ context, user, tripId }) {
  const { companyId, branchId } = context;
  const [[trip]] = await db.execute(
    "SELECT trip_ticket_id AS id FROM trip_tickets WHERE trip_ticket_id = ? AND company_id = ? AND branch_id = ? LIMIT 1",
    [tripId, companyId, branchId]
  );
  if (!trip) return { status: 404, error: "Trip not found in this branch." };

  const [[existing]] = await db.execute(
    `SELECT token, expires_at AS expiresAt, created_at AS createdAt, view_count AS viewCount, last_viewed_at AS lastViewedAt
       FROM trip_tracking_links
      WHERE trip_ticket_id = ? AND revoked_at IS NULL AND expires_at > NOW(3)
      ORDER BY link_id DESC LIMIT 1`,
    [tripId]
  );
  if (existing) return { link: existing };

  const token = crypto.randomBytes(32).toString("base64url");
  await db.execute(
    `INSERT INTO trip_tracking_links (company_id, branch_id, trip_ticket_id, token, created_by_user_id, expires_at)
     VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(3), INTERVAL ${LINK_DAYS} DAY))`,
    [companyId, branchId, tripId, token, user.userId]
  );
  const [[created]] = await db.execute(
    "SELECT token, expires_at AS expiresAt, created_at AS createdAt, view_count AS viewCount, last_viewed_at AS lastViewedAt FROM trip_tracking_links WHERE token = ?",
    [token]
  );
  return { link: created, created: true };
}

/** Stop every link for a trip working. The customer's page answers "no longer available". */
export async function revokeLinks({ context, tripId }) {
  const { companyId, branchId } = context;
  const [result] = await db.execute(
    `UPDATE trip_tracking_links SET revoked_at = NOW(3)
      WHERE trip_ticket_id = ? AND company_id = ? AND branch_id = ? AND revoked_at IS NULL`,
    [tripId, companyId, branchId]
  );
  return { revoked: result.affectedRows };
}

/** How a trip's status reads to a customer. */
const CUSTOMER_STAGE = {
  draft: ["scheduled", "Being planned"],
  for_validation: ["scheduled", "Being planned"],
  validated: ["scheduled", "Being planned"],
  for_approval: ["scheduled", "Being planned"],
  approved: ["scheduled", "Scheduled"],
  rejected: ["scheduled", "Being planned"],
  assigned: ["scheduled", "Scheduled"],
  accepted: ["scheduled", "Scheduled"],
  released: ["ready", "Ready to leave"],
  in_transit: ["on_the_way", "On the way"],
  delivered: ["delivered", "Delivered"],
  returned: ["delivered", "Delivered"],
  operationally_closed: ["delivered", "Delivered"],
  cancelled: ["cancelled", "Cancelled"],
};

/**
 * What a customer may see of a delivery, from the link they were given.
 * Returns { view } or { gone: true } (unknown, revoked or expired — which the
 * page must not tell apart, so a guessed token learns nothing).
 */
export async function publicView(token) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(String(token ?? ""))) return { gone: true };
  const [[row]] = await db.execute(
    `SELECT l.link_id AS linkId, l.trip_ticket_id AS tripId, l.expires_at AS expiresAt, l.revoked_at AS revokedAt,
            tt.ticket_no AS tripNo, tt.status, tt.origin, tt.destination,
            tt.scheduled_arrival AS scheduledArrival, tt.actual_departure AS departedAt, tt.actual_arrival AS arrivedAt,
            c.company_name AS companyName, cu.customer_name AS customerName
       FROM trip_tracking_links l
       JOIN trip_tickets tt ON tt.trip_ticket_id = l.trip_ticket_id
       JOIN companies c ON c.company_id = tt.company_id
       LEFT JOIN customers cu ON cu.customer_id = tt.customer_id
      WHERE l.token = ? LIMIT 1`,
    [token]
  );
  if (!row || row.revokedAt || new Date(row.expiresAt).getTime() <= Date.now()) return { gone: true };

  const [pauses] = await db.execute(
    `SELECT reason, status, reviewed_at AS startedAt, resumed_at AS endedAt, customer_message AS message
       FROM trip_pauses
      WHERE trip_ticket_id = ? AND status IN ('approved','resumed')
      ORDER BY pause_id DESC LIMIT 6`,
    [row.tripId]
  );
  const shown = pauses.map((p) => ({
    reason: p.reason,
    reasonLabel: REASON_LABEL[p.reason] || p.reason,
    message: p.message || CUSTOMER_DEFAULT[p.reason] || CUSTOMER_DEFAULT.other,
    startedAt: p.startedAt,
    endedAt: p.endedAt,
    active: p.status === "approved",
  }));
  const active = shown.find((p) => p.active) || null;

  const [stage, label] = CUSTOMER_STAGE[row.status] || ["scheduled", "Scheduled"];
  // Best effort: a page view is never the reason a page fails to load.
  db.execute("UPDATE trip_tracking_links SET view_count = view_count + 1, last_viewed_at = NOW(3) WHERE link_id = ?", [row.linkId]).catch(() => {});

  return {
    view: {
      company: row.companyName,
      customer: row.customerName || null,
      tripNo: row.tripNo,
      origin: row.origin,
      destination: row.destination,
      stage: active ? "paused" : stage,
      statusLabel: active ? "Paused" : label,
      scheduledArrival: row.scheduledArrival,
      departedAt: row.departedAt,
      arrivedAt: row.arrivedAt,
      pause: active,
      pastPauses: shown.filter((p) => !p.active),
      asOf: new Date().toISOString(),
    },
  };
}
