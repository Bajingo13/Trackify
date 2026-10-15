import db from "../../config/db.js";
import { publish, publishToDriver } from "../../realtime/hub.js";
import { notifyDriver } from "../support/push.service.js";

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

/**
 * The words that may travel with a photo. Unlike a message they may be empty —
 * the picture is the message — so this trims and bounds but never demands text.
 */
export function checkCaption(value) {
  const caption = String(value ?? "").replace(/\r\n?/g, "\n").trim();
  if (caption.length > MAX_BODY) return { error: `Keep a caption under ${MAX_BODY} characters.` };
  return { caption };
}

/** A device-chosen id that makes a replayed send harmless. Anything else is ignored. */
export function checkClientRef(value) {
  const ref = String(value ?? "");
  return /^[A-Za-z0-9_-]{8,64}$/.test(ref) ? ref : null;
}

const SELECT = `
  SELECT message_id AS id, trip_ticket_id AS tripId, sender_kind AS senderKind,
         sender_user_id AS senderUserId, sender_driver_id AS senderDriverId,
         sender_name AS senderName, body, client_ref AS clientRef, created_at AS createdAt,
         (photo_path IS NOT NULL) AS hasPhoto
    FROM trip_messages`;

/*
 * Where a photo is stored never leaves the server: the row is told only that it
 * has one, and the picture itself is fetched through an authenticated route.
 */
const tidy = (row) => ({ ...row, hasPhoto: Boolean(row.hasPhoto) });

/** Oldest first. `after` lets a client fetch only what it has not seen. */
export async function listMessages(tripId, { after = 0, limit = 500 } = {}) {
  const since = Number.isInteger(Number(after)) && Number(after) > 0 ? Number(after) : 0;
  const cap = Math.min(Math.max(Number(limit) || 500, 1), 500);
  const [rows] = await db.execute(
    `${SELECT} WHERE trip_ticket_id = ? AND message_id > ? ORDER BY message_id LIMIT ${cap}`,
    [tripId, since]
  );
  return rows.map(tidy);
}

/** The stored photo of one message in one trip, or null. The trip scope is part of the lookup. */
export async function findPhoto(tripId, messageId) {
  const id = Number(messageId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const [[row]] = await db.execute(
    `SELECT photo_path AS path, photo_mime AS mime FROM trip_messages
      WHERE trip_ticket_id = ? AND message_id = ? AND photo_path IS NOT NULL LIMIT 1`,
    [tripId, id]
  );
  return row || null;
}

/**
 * Store one message and tell dispatch in real time.
 *
 * A second arrival of the same client_ref returns the message already stored,
 * so a phone replaying its outbox after a lost reply does not post twice.
 */
export async function postMessage({
  companyId, branchId, tripId, senderKind, senderUserId = null, senderDriverId = null,
  senderName, body, clientRef = null, photo = null,
}) {
  let id;
  let duplicate = false;
  try {
    const [result] = await db.execute(
      `INSERT INTO trip_messages
         (company_id, branch_id, trip_ticket_id, sender_kind, sender_user_id, sender_driver_id,
          sender_name, body, client_ref, photo_path, photo_mime, photo_size)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [companyId, branchId, tripId, senderKind, senderUserId, senderDriverId,
        String(senderName || "").slice(0, 150) || (senderKind === "driver" ? "Driver" : "Dispatch"),
        body, clientRef, photo?.path ?? null, photo?.mime ?? null, photo?.size ?? null]
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

  const [[row]] = await db.execute(`${SELECT} WHERE message_id = ?`, [id]);
  const message = tidy(row);

  // Your own message is read by definition.
  await markRead({
    tripId,
    readerKind: senderKind,
    readerId: senderKind === "driver" ? senderDriverId : senderUserId,
    lastMessageId: id,
  });

  if (!duplicate) {
    publish(companyId, branchId, { type: "trip:message", tripId, message });
    if (senderKind === "staff") await tellDriver({ companyId, tripId, message });
  }
  return { message, duplicate };
}

/**
 * Dispatch has written: tell the driver the run is assigned to. Live, on the
 * Driver App socket (the bell and an open chat refresh at once), and as a push
 * notice for a phone whose app is closed. The push says only that dispatch
 * wrote and about which run — a lock screen is public, so never what was said.
 * A notice is a courtesy: failing to send one never fails the message.
 */
export async function tellDriver({ companyId, tripId, message }) {
  try {
    const [[to]] = await db.execute(
      `SELECT ta.driver_id AS driverId, tt.ticket_no AS ticketNo
         FROM trip_assignments ta
         JOIN trip_tickets tt ON tt.trip_ticket_id = ta.trip_ticket_id
        WHERE ta.trip_ticket_id = ? AND ta.is_current = TRUE AND tt.company_id = ? LIMIT 1`,
      [tripId, companyId]
    );
    if (!to?.driverId) return;
    publishToDriver(companyId, to.driverId, {
      type: "chat:message",
      channel: "trip",
      tripId: Number(tripId),
      ticketNo: to.ticketNo,
      messageId: message.id,
      from: message.senderName || "Dispatch",
      preview: String(message.body || "").replace(/\s+/g, " ").trim().slice(0, 120) || (message.hasPhoto ? "Sent a photo" : ""),
      at: message.createdAt,
    });
    void notifyDriver({
      companyId,
      driverId: to.driverId,
      tag: `trip-chat-${tripId}`,
      title: `Dispatch wrote about ${to.ticketNo}`,
      body: "Open Trackify to read the message.",
    });
  } catch (error) {
    console.error(`[chat] could not notify the driver of trip ${tripId}: ${error?.code || error?.message || error}`);
  }
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

  // What the newest unread message says and when, so a list of conversations can
  // show a preview. The ids are the ones just selected, so this reads nothing the
  // caller was not already told it has.
  const ids = rows.map((row) => Number(row.lastMessageId)).filter(Number.isInteger);
  const latest = new Map();
  if (ids.length) {
    const [msgs] = await db.execute(
      `SELECT message_id AS id, body, sender_name AS senderName, created_at AS createdAt,
              (photo_path IS NOT NULL) AS hasPhoto
         FROM trip_messages WHERE message_id IN (${ids.map(() => "?").join(",")})`,
      ids
    );
    for (const m of msgs) {
      latest.set(Number(m.id), { body: m.body, senderName: m.senderName, createdAt: m.createdAt, hasPhoto: Boolean(m.hasPhoto) });
    }
  }
  return rows.map((row) => ({
    ...row,
    unread: Number(row.unread),
    lastMessage: latest.get(Number(row.lastMessageId)) || null,
  }));
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
