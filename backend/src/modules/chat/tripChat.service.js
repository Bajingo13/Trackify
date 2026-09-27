import db from "../../config/db.js";
import { publish } from "../../realtime/hub.js";

/**
 * Trip chat — the part both sides share.
 *
 * The driver's controller and the dispatch controller each decide WHO may
 * reach a trip (the driver it is assigned to; staff in the trip's branch).
 * Everything after that — what a message may contain, how a replay is made
 * harmless, what counts as unread — lives here, so the two sides cannot drift.
 */

export const MAX_BODY = 1000;

/*
 * The thread becomes read-only once the trip is over. It stays readable: it
 * is the record of what was said about that delivery.
 */
const CLOSED = new Set(["operationally_closed", "cancelled"]);
export const isClosed = (status) => CLOSED.has(status);

/** Trimmed text, or an error sentence the sender can act on. */
export function checkBody(value) {
  const body = String(value ?? "").replace(/\r\n?/g, "\n").trim();
  if (!body) return { error: "Type a message first." };
  if (body.length > MAX_BODY) return { error: `Keep a message under ${MAX_BODY} characters.` };
  return { body };
}

/** A device-chosen id that makes a replayed send harmless. Anything else is ignored. */
export function checkClientRef(value) {
  const ref = String(value ?? "");
  return /^[A-Za-z0-9_-]{8,64}$/.test(ref) ? ref : null;
}

const SELECT = `
  SELECT message_id AS id, trip_ticket_id AS tripId, sender_kind AS senderKind,
         sender_user_id AS senderUserId, sender_driver_id AS senderDriverId,
         sender_name AS senderName, body, client_ref AS clientRef, created_at AS createdAt
    FROM trip_messages`;

/** Oldest first. `after` lets a client fetch only what it has not seen. */
export async function listMessages(tripId, { after = 0, limit = 500 } = {}) {
  const since = Number.isInteger(Number(after)) && Number(after) > 0 ? Number(after) : 0;
  const cap = Math.min(Math.max(Number(limit) || 500, 1), 500);
  const [rows] = await db.execute(
    `${SELECT} WHERE trip_ticket_id = ? AND message_id > ? ORDER BY message_id LIMIT ${cap}`,
    [tripId, since]
  );
  return rows;
}

/**
 * Store one message and tell dispatch in real time.
 *
 * A second arrival of the same client_ref returns the message already stored,
 * so a phone replaying its outbox after a lost reply does not post twice.
 */
export async function postMessage({
  companyId, branchId, tripId, senderKind, senderUserId = null, senderDriverId = null,
  senderName, body, clientRef = null,
}) {
  let id;
  let duplicate = false;
  try {
    const [result] = await db.execute(
      `INSERT INTO trip_messages
         (company_id, branch_id, trip_ticket_id, sender_kind, sender_user_id, sender_driver_id,
          sender_name, body, client_ref)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [companyId, branchId, tripId, senderKind, senderUserId, senderDriverId,
        String(senderName || "").slice(0, 150) || (senderKind === "driver" ? "Driver" : "Dispatch"),
        body, clientRef]
    );
    id = result.insertId;
  } catch (error) {
    if (error.code !== "ER_DUP_ENTRY" || !clientRef) throw error;
    const [[existing]] = await db.execute(
      "SELECT message_id FROM trip_messages WHERE trip_ticket_id = ? AND client_ref = ? LIMIT 1",
      [tripId, clientRef]
    );
    id = existing.message_id;
    duplicate = true;
  }

  const [[message]] = await db.execute(`${SELECT} WHERE message_id = ?`, [id]);

  // Your own message is read by definition.
  await markRead({
    tripId,
    readerKind: senderKind,
    readerId: senderKind === "driver" ? senderDriverId : senderUserId,
    lastMessageId: id,
  });

  if (!duplicate) {
    publish(companyId, branchId, { type: "trip:message", tripId, message });
  }
  return { message, duplicate };
}

/** Only ever moves forward, so a late, stale read cannot un-read newer messages. */
export async function markRead({ tripId, readerKind, readerId, lastMessageId }) {
  const last = Number(lastMessageId);
  if (!readerId || !Number.isInteger(last) || last <= 0) return;
  await db.execute(
    `INSERT INTO trip_message_reads (trip_ticket_id, reader_kind, reader_id, last_read_message_id)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE last_read_message_id = GREATEST(last_read_message_id, VALUES(last_read_message_id))`,
    [tripId, readerKind, readerId, last]
  );
}

/**
 * Messages from the other side that this reader has not read, per trip.
 * `where` narrows to the trips the caller is allowed to see.
 */
async function unreadBy({ readerKind, readerId, where, params }) {
  const otherSide = readerKind === "driver" ? "staff" : "driver";
  const [rows] = await db.execute(
    `SELECT m.trip_ticket_id AS tripId, tt.ticket_no AS ticketNo, COUNT(*) AS unread,
            MAX(m.message_id) AS lastMessageId
       FROM trip_messages m
       JOIN trip_tickets tt ON tt.trip_ticket_id = m.trip_ticket_id
       LEFT JOIN trip_message_reads r
         ON r.trip_ticket_id = m.trip_ticket_id AND r.reader_kind = ? AND r.reader_id = ?
      WHERE m.sender_kind = ?
        AND m.message_id > COALESCE(r.last_read_message_id, 0)
        AND ${where}
      GROUP BY m.trip_ticket_id, tt.ticket_no
      ORDER BY lastMessageId DESC`,
    [readerKind, readerId, otherSide, ...params]
  );
  return rows.map((row) => ({ ...row, unread: Number(row.unread) }));
}

/** For one member of staff, across their operating branch. */
export const staffUnread = ({ userId, companyId, branchId }) =>
  unreadBy({
    readerKind: "staff",
    readerId: userId,
    where: "m.company_id = ? AND m.branch_id = ?",
    params: [companyId, branchId],
  });

/** For a driver, across the trips currently assigned to them. */
export const driverUnread = ({ driverId, companyId }) =>
  unreadBy({
    readerKind: "driver",
    readerId: driverId,
    where: `m.company_id = ? AND EXISTS (
              SELECT 1 FROM trip_assignments ta
               WHERE ta.trip_ticket_id = m.trip_ticket_id AND ta.driver_id = ? AND ta.is_current = TRUE)`,
    params: [companyId, driverId],
  });
