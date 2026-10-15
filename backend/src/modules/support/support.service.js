import db from "../../config/db.js";
import { publish, publishToDriver } from "../../realtime/hub.js";
import { notifyDriver } from "./push.service.js";
import { EXCEPTION_CATEGORIES, openForTicket, settleForTicket } from "./exceptionSync.service.js";

/**
 * Driver Help & Support, both ends.
 *
 * A driver reaches only their own requests. Staff reach only the requests of
 * the branch they are operating in — the same rule as every other branch screen.
 * Past that point both sides read and write the same thread.
 *
 * Nothing is edited or deleted by either side: what was said can be relied on
 * if a concern is later disputed.
 */

export const CATEGORIES = ["trip", "vehicle", "payment", "app", "safety", "account", "other"];
export const PRIORITIES = ["normal", "urgent"];
export const STATUSES = ["open", "in_progress", "resolved", "closed"];

const MAX_SUBJECT = 120;
const MAX_BODY = 2000;
/** Open requests one driver may have at once — a ceiling on spam, far above real use. */
export const MAX_OPEN_PER_DRIVER = 10;

const clean = (value) => String(value ?? "").replace(/\r\n?/g, "\n").trim();

/** Trimmed text for the first message or a reply, or an error sentence the sender can act on. */
export function checkBody(value) {
  const body = clean(value);
  if (!body) return { error: "Write your message first." };
  if (body.length > MAX_BODY) return { error: `Keep a message under ${MAX_BODY} characters.` };
  return { body };
}

export function checkSubject(value) {
  const subject = clean(value).replace(/\s+/g, " ");
  if (subject.length < 3) return { error: "Give your request a short title (at least 3 characters)." };
  if (subject.length > MAX_SUBJECT) return { error: `Keep the title under ${MAX_SUBJECT} characters.` };
  return { subject };
}

/** A device-chosen id that makes a replayed send harmless. Anything else is ignored. */
export function checkClientRef(value) {
  const ref = String(value ?? "");
  return /^[A-Za-z0-9_-]{8,64}$/.test(ref) ? ref : null;
}

/** "SUP-000042": the number a driver and the office use to talk about a request. */
export const ticketNo = (id) => `SUP-${String(id).padStart(6, "0")}`;

/* What either side is shown about a message. Internal account ids stay home. */
const messageView = (row, mine) => ({
  id: row.id,
  ticketId: row.ticketId,
  senderKind: row.senderKind,
  senderName: row.senderName,
  body: row.body,
  clientRef: row.clientRef,
  createdAt: row.createdAt,
  mine,
});

const TICKET_SELECT = `
  SELECT t.ticket_id AS id, t.company_id AS companyId, t.branch_id AS branchId,
         t.driver_id AS driverId, t.driver_name AS driverName,
         t.trip_ticket_id AS tripId, tt.ticket_no AS tripNo,
         t.category, t.priority, t.subject, t.status,
         t.assigned_user_id AS assignedUserId, t.assigned_name AS assignedName,
         t.created_at AS createdAt, t.updated_at AS updatedAt, t.resolved_at AS resolvedAt,
         t.driver_last_read_message_id AS driverLastRead,
         t.staff_last_read_message_id AS staffLastRead,
         (SELECT MAX(m.message_id) FROM support_messages m WHERE m.ticket_id = t.ticket_id) AS lastMessageId,
         (SELECT MAX(m.message_id) FROM support_messages m
           WHERE m.ticket_id = t.ticket_id AND m.sender_kind = 'staff') AS lastStaffMessageId,
         (SELECT MAX(m.message_id) FROM support_messages m
           WHERE m.ticket_id = t.ticket_id AND m.sender_kind = 'driver') AS lastDriverMessageId,
         (SELECT m.body FROM support_messages m WHERE m.ticket_id = t.ticket_id
           ORDER BY m.message_id DESC LIMIT 1) AS lastBody,
         (SELECT m.sender_kind FROM support_messages m WHERE m.ticket_id = t.ticket_id
           ORDER BY m.message_id DESC LIMIT 1) AS lastSender,
         (SELECT MIN(m.created_at) FROM support_messages m
           WHERE m.ticket_id = t.ticket_id AND m.sender_kind = 'staff') AS firstResponseAt,
         (SELECT p.pause_id FROM trip_pauses p WHERE p.ticket_id = t.ticket_id LIMIT 1) AS pauseId,
         (SELECT p.status FROM trip_pauses p WHERE p.ticket_id = t.ticket_id LIMIT 1) AS pauseStatus,
         (SELECT p.reason FROM trip_pauses p WHERE p.ticket_id = t.ticket_id LIMIT 1) AS pauseReason
    FROM support_tickets t
    LEFT JOIN trip_tickets tt ON tt.trip_ticket_id = t.trip_ticket_id`;

const snippet = (text) => {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  return s.length > 90 ? `${s.slice(0, 89)}…` : s;
};

/** One request, as either side is shown it. `unread` is from the reader's own side. */
function ticketView(row, side) {
  const unread = side === "driver"
    ? Number(row.lastStaffMessageId || 0) > Number(row.driverLastRead || 0)
    : Number(row.lastDriverMessageId || 0) > Number(row.staffLastRead || 0);
  return {
    id: row.id,
    ticketNo: ticketNo(row.id),
    category: row.category,
    priority: row.priority,
    subject: row.subject,
    status: row.status,
    tripId: row.tripId,
    tripNo: row.tripNo,
    assignedName: row.assignedName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    resolvedAt: row.resolvedAt,
    // when the office first answered: the second step of "sent, answered, resolved"
    acknowledgedAt: row.firstResponseAt || null,
    // a request that asks to pause a delivery says so, in the list as in the thread
    pause: row.pauseId ? { id: row.pauseId, status: row.pauseStatus, reason: row.pauseReason } : null,
    lastBody: snippet(row.lastBody),
    lastSender: row.lastSender,
    unread,
    ...(side === "staff" ? { driverId: row.driverId, driverName: row.driverName } : {}),
  };
}

const MESSAGE_SELECT = `
  SELECT message_id AS id, ticket_id AS ticketId, sender_kind AS senderKind,
         sender_user_id AS senderUserId, sender_driver_id AS senderDriverId,
         sender_name AS senderName, body, client_ref AS clientRef, created_at AS createdAt
    FROM support_messages`;

async function messagesOf(ticketId, mine) {
  const [rows] = await db.execute(`${MESSAGE_SELECT} WHERE ticket_id = ? ORDER BY message_id ASC LIMIT 500`, [ticketId]);
  return rows.map((r) => messageView(r, mine(r)));
}

/** Only ever moves forward, so a late, stale read cannot un-read newer messages. */
async function markRead(ticketId, side, lastMessageId) {
  const last = Number(lastMessageId);
  if (!Number.isInteger(last) || last <= 0) return;
  const column = side === "driver" ? "driver_last_read_message_id" : "staff_last_read_message_id";
  await db.execute(
    `UPDATE support_tickets SET ${column} = GREATEST(${column}, ?) WHERE ticket_id = ?`,
    [last, ticketId]
  );
}

/* ---------------------------------------------------------------- */
/* Driver                                                           */
/* ---------------------------------------------------------------- */

// Requests still being worked come first, so the cap can only ever cut off old finished ones
// (the app shows those under History).
export async function listForDriver({ driverId, companyId }) {
  const [rows] = await db.execute(
    `${TICKET_SELECT}
      WHERE t.driver_id = ? AND t.company_id = ?
      ORDER BY (t.status IN ('open', 'in_progress')) DESC, t.updated_at DESC, t.ticket_id DESC
      LIMIT 100`,
    [driverId, companyId]
  );
  return rows.map((r) => ticketView(r, "driver"));
}

/** How many of this driver's requests have an answer they have not read. */
export async function unreadForDriver({ driverId, companyId }) {
  const [[row]] = await db.execute(
    `SELECT COUNT(*) AS n FROM support_tickets t
      WHERE t.driver_id = ? AND t.company_id = ?
        AND (SELECT COALESCE(MAX(m.message_id), 0) FROM support_messages m
              WHERE m.ticket_id = t.ticket_id AND m.sender_kind = 'staff') > t.driver_last_read_message_id`,
    [driverId, companyId]
  );
  return Number(row?.n || 0);
}

/**
 * The requests the office has answered since the driver last read them, one
 * row each, newest answer first: what the Driver App's notification bell lists,
 * so a reply from dispatch is seen from any tab and not only on Help.
 * `unread` is how many office messages are new in that conversation.
 */
export async function unreadListForDriver({ driverId, companyId }, limit = 20) {
  const [rows] = await db.execute(
    `SELECT t.ticket_id AS id, t.subject, t.trip_ticket_id AS tripId, tt.ticket_no AS tripNo,
            COUNT(m.message_id) AS unread, MAX(m.created_at) AS lastAt,
            (SELECT m2.body FROM support_messages m2
              WHERE m2.ticket_id = t.ticket_id AND m2.sender_kind = 'staff'
              ORDER BY m2.message_id DESC LIMIT 1) AS lastBody
       FROM support_tickets t
       JOIN support_messages m ON m.ticket_id = t.ticket_id
            AND m.sender_kind = 'staff' AND m.message_id > t.driver_last_read_message_id
       LEFT JOIN trip_tickets tt ON tt.trip_ticket_id = t.trip_ticket_id
      WHERE t.driver_id = ? AND t.company_id = ?
      GROUP BY t.ticket_id, t.subject, t.trip_ticket_id, tt.ticket_no
      ORDER BY lastAt DESC
      LIMIT ${Math.max(1, Math.min(50, Number(limit) || 20))}`,
    [driverId, companyId]
  );
  return rows.map((r) => ({
    id: r.id,
    ticketNo: ticketNo(r.id),
    subject: r.subject,
    tripId: r.tripId,
    tripNo: r.tripNo || null,
    unread: Number(r.unread),
    lastAt: r.lastAt,
    // a line of the latest reply, enough to know what it is about
    preview: String(r.lastBody || "").replace(/\s+/g, " ").trim().slice(0, 120),
  }));
}

/** A trip this driver is, or was, assigned to — the only kind they may link a request to. */
async function driverTrip({ driverId, companyId, tripId }) {
  const [[trip]] = await db.execute(
    `SELECT tt.trip_ticket_id AS id, tt.branch_id AS branchId
       FROM trip_assignments ta
       JOIN trip_tickets tt ON tt.trip_ticket_id = ta.trip_ticket_id
      WHERE ta.driver_id = ? AND tt.company_id = ? AND tt.trip_ticket_id = ? LIMIT 1`,
    [driverId, companyId, tripId]
  );
  return trip || null;
}

/**
 * Write a request and its first message on the caller's connection, so that
 * something else — a pause request — can file its ticket in the same
 * transaction as itself. Returns { id, messageId }.
 */
export async function createTicketTx(conn, { driver, branchId, tripId = null, category, priority = "normal", subject, body, clientRef = null }) {
  const [created] = await conn.execute(
    `INSERT INTO support_tickets
       (company_id, branch_id, driver_id, driver_name, trip_ticket_id, category, priority, subject, client_ref)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [driver.companyId, branchId, driver.driverId, driver.name.slice(0, 150), tripId, category, priority, subject, clientRef]
  );
  const id = created.insertId;
  const [first] = await conn.execute(
    `INSERT INTO support_messages (ticket_id, sender_kind, sender_driver_id, sender_name, body)
     VALUES (?, 'driver', ?, ?, ?)`,
    [id, driver.driverId, driver.name.slice(0, 150), body]
  );
  // the driver's own words are read by definition
  await conn.execute("UPDATE support_tickets SET driver_last_read_message_id = ? WHERE ticket_id = ?", [first.insertId, id]);
  return { id, messageId: first.insertId };
}

/**
 * A line from the office on a request, written by the system on a person's
 * behalf — "approved", "declined", "resumed". It reaches the driver the way any
 * reply does: in the thread, with the dot on the help button.
 */
export async function appendStaffNote(conn, { ticketId, user, body, companyId, branchId }) {
  const name = String(user.name || user.email || "Support").slice(0, 150);
  const [result] = await conn.execute(
    `INSERT INTO support_messages (ticket_id, sender_kind, sender_user_id, sender_name, body)
     VALUES (?, 'staff', ?, ?, ?)`,
    [ticketId, user.userId, name, String(body).slice(0, 2000)]
  );
  await conn.execute(
    `UPDATE support_tickets
        SET assigned_user_id = COALESCE(assigned_user_id, ?), assigned_name = COALESCE(assigned_name, ?)
      WHERE ticket_id = ?`,
    [user.userId, name, ticketId]
  );
  return { id: result.insertId, ticketId, senderKind: "staff", senderName: name, body, companyId, branchId };
}

/** Where a request stands, with its resolved stamp kept in step. */
export async function setTicketStatus(conn, ticketId, status) {
  const done = status === "resolved" || status === "closed";
  await conn.execute(
    `UPDATE support_tickets
        SET status = ?, resolved_at = ${done ? "COALESCE(resolved_at, NOW(3))" : "NULL"}
      WHERE ticket_id = ?`,
    [status, ticketId]
  );
}

/**
 * The one delivery the driver is on the road with right now, if there is exactly one.
 * A report about the truck, the road or safety is about that delivery whether or not the
 * driver thought to say so, and it belongs with the branch running it, not the driver's home
 * branch, or the office that can act on it would never see it.
 */
async function currentRoadTrip({ driverId, companyId }) {
  const [rows] = await db.execute(
    `SELECT tt.trip_ticket_id AS id, tt.branch_id AS branchId
       FROM trip_assignments ta
       JOIN trip_tickets tt ON tt.trip_ticket_id = ta.trip_ticket_id
      WHERE ta.driver_id = ? AND ta.is_current = TRUE AND tt.company_id = ? AND tt.status = 'in_transit' LIMIT 2`,
    [driverId, companyId]
  );
  return Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
}

/**
 * File a request. Returns { ticket, duplicate } or { error, status }.
 *
 * A second arrival of the same client_ref returns the request already stored,
 * so a phone replaying its outbox after a lost reply does not file twice.
 */
export async function createForDriver({ driver, input }) {
  const { subject, error: subjectError } = checkSubject(input.subject);
  if (subjectError) return { status: 400, error: subjectError };
  const { body, error: bodyError } = checkBody(input.message);
  if (bodyError) return { status: 400, error: bodyError };
  const category = CATEGORIES.includes(input.category) ? input.category : null;
  if (!category) return { status: 400, error: "Choose what your request is about." };
  const priority = input.urgent ? "urgent" : "normal";
  const clientRef = checkClientRef(input.clientRef);

  if (clientRef) {
    const [[existing]] = await db.execute(
      "SELECT ticket_id AS id FROM support_tickets WHERE driver_id = ? AND client_ref = ? LIMIT 1",
      [driver.driverId, clientRef]
    );
    if (existing) return { ticket: await getForDriver({ driver, id: existing.id }), duplicate: true };
  }

  let tripId = null;
  let branchId = driver.branchId;
  if (input.tripId != null && input.tripId !== "") {
    const trip = await driverTrip({ driverId: driver.driverId, companyId: driver.companyId, tripId: Number(input.tripId) });
    if (!trip) return { status: 404, error: "That trip isn't one of yours." };
    tripId = trip.id;
    branchId = trip.branchId;
  } else if (EXCEPTION_CATEGORIES.has(category)) {
    const onTheRoad = await currentRoadTrip({ driverId: driver.driverId, companyId: driver.companyId });
    if (onTheRoad) {
      tripId = onTheRoad.id;
      branchId = onTheRoad.branchId;
    }
  }
  if (!branchId) {
    return { status: 409, error: "Your driver record isn't assigned to a branch yet, so this can't be sent. Please ask your supervisor." };
  }

  const [[open]] = await db.execute(
    "SELECT COUNT(*) AS n FROM support_tickets WHERE driver_id = ? AND status IN ('open','in_progress')",
    [driver.driverId]
  );
  if (Number(open?.n || 0) >= MAX_OPEN_PER_DRIVER) {
    return { status: 429, error: `You already have ${MAX_OPEN_PER_DRIVER} open requests. Wait for a reply, or add to one of them.` };
  }

  const conn = await db.getConnection();
  let id;
  try {
    await conn.beginTransaction();
    ({ id } = await createTicketTx(conn, { driver, branchId, tripId, category, priority, subject, body, clientRef }));
    if (EXCEPTION_CATEGORIES.has(category)) {
      await openForTicket(conn, {
        companyId: driver.companyId, branchId, tripId, ticketId: id, category, priority,
        driverName: driver.name, subject, body,
      });
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    if (err.code === "ER_DUP_ENTRY" && clientRef) {
      const [[existing]] = await db.execute(
        "SELECT ticket_id AS id FROM support_tickets WHERE driver_id = ? AND client_ref = ? LIMIT 1",
        [driver.driverId, clientRef]
      );
      if (existing) return { ticket: await getForDriver({ driver, id: existing.id }), duplicate: true };
    }
    throw err;
  } finally {
    conn.release();
  }

  const ticket = await getForDriver({ driver, id });
  publish(driver.companyId, branchId, {
    type: "support:ticket",
    ticket: { id, ticketNo: ticketNo(id), subject, category, priority, status: "open", driverName: driver.name },
  });
  return { ticket, duplicate: false };
}

/** One request with its thread. Reading it marks the answers read. */
export async function getForDriver({ driver, id }) {
  const [[row]] = await db.execute(
    `${TICKET_SELECT} WHERE t.ticket_id = ? AND t.driver_id = ? AND t.company_id = ? LIMIT 1`,
    [id, driver.driverId, driver.companyId]
  );
  if (!row) return null;
  const messages = await messagesOf(row.id, (m) => m.senderKind === "driver" && m.senderDriverId === driver.driverId);
  await markRead(row.id, "driver", row.lastMessageId);
  return { ...ticketView({ ...row, driverLastRead: row.lastMessageId }, "driver"), messages };
}

/** The driver writes again. Returns { message, duplicate } or { error, status }. */
export async function replyAsDriver({ driver, id, input }) {
  const { body, error } = checkBody(input.body);
  if (error) return { status: 400, error };
  const clientRef = checkClientRef(input.clientRef);

  const [[ticket]] = await db.execute(
    "SELECT ticket_id AS id, branch_id AS branchId, status FROM support_tickets WHERE ticket_id = ? AND driver_id = ? AND company_id = ? LIMIT 1",
    [id, driver.driverId, driver.companyId]
  );
  if (!ticket) return { status: 404, error: "That request isn't yours." };
  if (ticket.status === "closed") {
    return { status: 409, error: "This request is closed. File a new one if you still need help." };
  }

  let messageId;
  let duplicate = false;
  try {
    const [result] = await db.execute(
      `INSERT INTO support_messages (ticket_id, sender_kind, sender_driver_id, sender_name, body, client_ref)
       VALUES (?, 'driver', ?, ?, ?, ?)`,
      [id, driver.driverId, driver.name.slice(0, 150), body, clientRef]
    );
    messageId = result.insertId;
  } catch (err) {
    if (err.code !== "ER_DUP_ENTRY" || !clientRef) throw err;
    const [[existing]] = await db.execute(
      "SELECT message_id FROM support_messages WHERE ticket_id = ? AND client_ref = ? LIMIT 1",
      [id, clientRef]
    );
    messageId = existing.message_id;
    duplicate = true;
  }

  if (!duplicate) {
    // Writing back to a request marked resolved says it is not: it reopens.
    await db.execute(
      `UPDATE support_tickets
          SET status = IF(status = 'resolved', 'open', status),
              resolved_at = IF(status = 'resolved', NULL, resolved_at)
        WHERE ticket_id = ?`,
      [id]
    );
    if (ticket.status === "resolved") await settleForTicket(db, id, "open");
  }
  await markRead(id, "driver", messageId);
  const [[row]] = await db.execute(`${MESSAGE_SELECT} WHERE message_id = ?`, [messageId]);
  const message = messageView(row, true);
  if (!duplicate) publish(driver.companyId, ticket.branchId, { type: "support:message", ticketId: id, message });
  return { message, duplicate };
}

/** How long after it finished a driver may still reopen a request. After that they file a new one. */
export const REOPEN_DAYS = 30;

/**
 * The driver reopens a request that was resolved or closed — for an answer that
 * did not fix it, say, without having to invent a message to do it.
 *
 * Not for a pause request: that one is a record of what happened to a delivery,
 * and a problem that comes back is a new pause on a new stop, not the old one
 * reopened. Not for a request finished more than REOPEN_DAYS ago either.
 * The office is told, in the thread, so it is not a silent change.
 */
export async function reopenForDriver({ driver, id }) {
  const [[ticket]] = await db.execute(
    `SELECT t.ticket_id AS id, t.branch_id AS branchId, t.status, t.resolved_at AS resolvedAt,
            (SELECT COUNT(*) FROM trip_pauses p WHERE p.ticket_id = t.ticket_id) AS pauses
       FROM support_tickets t
      WHERE t.ticket_id = ? AND t.driver_id = ? AND t.company_id = ? LIMIT 1`,
    [id, driver.driverId, driver.companyId]
  );
  if (!ticket) return { status: 404, error: "That request isn't yours." };
  if (ticket.status === "open" || ticket.status === "in_progress") {
    return { status: 409, error: "This request is already open." };
  }
  if (Number(ticket.pauses) > 0) {
    return { status: 409, error: "A pause request cannot be reopened. If the problem is back, send a new one." };
  }
  const finished = ticket.resolvedAt ? new Date(ticket.resolvedAt).getTime() : null;
  if (finished && Date.now() - finished > REOPEN_DAYS * 24 * 60 * 60 * 1000) {
    return { status: 409, error: `This request was finished more than ${REOPEN_DAYS} days ago. Please send a new one.` };
  }

  // the status in the WHERE makes two taps (or the office closing it at the same moment) reopen once
  const [result] = await db.execute(
    "UPDATE support_tickets SET status = 'open', resolved_at = NULL WHERE ticket_id = ? AND status IN ('resolved', 'closed')",
    [id]
  );
  if (!result.affectedRows) return { status: 409, error: "This request is already open." };

  const [message] = await db.execute(
    `INSERT INTO support_messages (ticket_id, sender_kind, sender_driver_id, sender_name, body)
     VALUES (?, 'driver', ?, ?, ?)`,
    [id, driver.driverId, driver.name.slice(0, 150), "Reopened this request."]
  );
  await settleForTicket(db, id, "open");
  const [[row]] = await db.execute(`${MESSAGE_SELECT} WHERE message_id = ?`, [message.insertId]);
  const view = messageView(row, true);
  publish(driver.companyId, ticket.branchId, { type: "support:message", ticketId: id, message: view });
  return { ticketId: id };
}

/* ---------------------------------------------------------------- */
/* Staff                                                            */
/* ---------------------------------------------------------------- */

const LIKE_ESCAPE = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** The operating branch's requests, newest activity first, with a count per status. */
export async function listForStaff({ companyId, branchId }, { status, category, priority, q } = {}) {
  const where = ["t.company_id = ?", "t.branch_id = ?"];
  const params = [companyId, branchId];
  if (STATUSES.includes(status)) { where.push("t.status = ?"); params.push(status); }
  else if (status === "active") where.push("t.status IN ('open','in_progress')");
  if (CATEGORIES.includes(category)) { where.push("t.category = ?"); params.push(category); }
  if (PRIORITIES.includes(priority)) { where.push("t.priority = ?"); params.push(priority); }
  const search = clean(q);
  if (search) {
    const like = `%${LIKE_ESCAPE(search)}%`;
    where.push("(t.subject LIKE ? OR t.driver_name LIKE ? OR tt.ticket_no LIKE ? OR CONCAT('SUP-', LPAD(t.ticket_id, 6, '0')) LIKE ?)");
    params.push(like, like, like, like);
  }

  const [rows] = await db.execute(
    `${TICKET_SELECT}
      WHERE ${where.join(" AND ")}
      ORDER BY (t.status IN ('open','in_progress')) DESC, (t.priority = 'urgent') DESC, t.updated_at DESC, t.ticket_id DESC
      LIMIT 200`,
    params
  );
  const [countRows] = await db.execute(
    "SELECT status, COUNT(*) AS n FROM support_tickets WHERE company_id = ? AND branch_id = ? GROUP BY status",
    [companyId, branchId]
  );
  const counts = { open: 0, in_progress: 0, resolved: 0, closed: 0 };
  for (const r of countRows) counts[r.status] = Number(r.n);
  return { tickets: rows.map((r) => ticketView(r, "staff")), counts };
}

/** Requests waiting on the office: active, with a driver message nobody on staff has read. */
export async function unreadForStaff({ companyId, branchId }) {
  const [[row]] = await db.execute(
    `SELECT COUNT(*) AS n FROM support_tickets t
      WHERE t.company_id = ? AND t.branch_id = ? AND t.status IN ('open','in_progress')
        AND (SELECT COALESCE(MAX(m.message_id), 0) FROM support_messages m
              WHERE m.ticket_id = t.ticket_id AND m.sender_kind = 'driver') > t.staff_last_read_message_id`,
    [companyId, branchId]
  );
  return Number(row?.n || 0);
}

/**
 * The same requests, one row each, for the console's notification bell: what
 * the driver said last, how many of their messages are new, and the exception
 * the request sits on (where the office reads and answers it — opening that
 * thread marks it read). A pause's request sits on the pause's exception.
 */
export async function unreadListForStaff({ companyId, branchId }, limit = 20) {
  const [rows] = await db.execute(
    `SELECT t.ticket_id AS id, t.subject, t.driver_name AS driverName, tt.ticket_no AS tripNo,
            COUNT(m.message_id) AS unread, MAX(m.created_at) AS lastAt,
            (SELECT m2.body FROM support_messages m2
              WHERE m2.ticket_id = t.ticket_id AND m2.sender_kind = 'driver'
              ORDER BY m2.message_id DESC LIMIT 1) AS lastBody,
            COALESCE(
              (SELECT e.exception_id FROM operational_exceptions e
                WHERE e.source_kind = 'support' AND e.source_id = t.ticket_id LIMIT 1),
              (SELECT e.exception_id FROM operational_exceptions e
                 JOIN trip_pauses p ON p.pause_id = e.source_id
                WHERE e.source_kind = 'pause' AND p.ticket_id = t.ticket_id LIMIT 1)
            ) AS exceptionId
       FROM support_tickets t
       JOIN support_messages m ON m.ticket_id = t.ticket_id
            AND m.sender_kind = 'driver' AND m.message_id > t.staff_last_read_message_id
       LEFT JOIN trip_tickets tt ON tt.trip_ticket_id = t.trip_ticket_id
      WHERE t.company_id = ? AND t.branch_id = ? AND t.status IN ('open','in_progress')
      GROUP BY t.ticket_id, t.subject, t.driver_name, tt.ticket_no
      ORDER BY lastAt DESC
      LIMIT ${Math.max(1, Math.min(50, Number(limit) || 20))}`,
    [companyId, branchId]
  );
  return rows.map((r) => ({
    id: r.id,
    ticketNo: ticketNo(r.id),
    subject: r.subject,
    driverName: r.driverName,
    tripNo: r.tripNo || null,
    exceptionId: r.exceptionId || null,
    unread: Number(r.unread),
    lastAt: r.lastAt,
    preview: String(r.lastBody || "").replace(/\s+/g, " ").trim().slice(0, 120),
  }));
}

export async function getForStaff({ companyId, branchId, id }) {
  const [[row]] = await db.execute(
    `${TICKET_SELECT} WHERE t.ticket_id = ? AND t.company_id = ? AND t.branch_id = ? LIMIT 1`,
    [id, companyId, branchId]
  );
  if (!row) return null;
  const messages = await messagesOf(row.id, (m) => m.senderKind === "staff");
  await markRead(row.id, "staff", row.lastMessageId);
  return { ...ticketView({ ...row, staffLastRead: row.lastMessageId }, "staff"), messages };
}

/**
 * Staff answer. Answering an open request takes it on: it moves to "in progress"
 * and, if nobody had it, is assigned to whoever replied. Returns { message } or { error, status }.
 */
export async function replyAsStaff({ context, user, id, input }) {
  const { body, error } = checkBody(input.body);
  if (error) return { status: 400, error };
  const { companyId, branchId } = context;

  const [[ticket]] = await db.execute(
    "SELECT ticket_id AS id, status, driver_id AS driverId, assigned_user_id AS assignedUserId FROM support_tickets WHERE ticket_id = ? AND company_id = ? AND branch_id = ? LIMIT 1",
    [id, companyId, branchId]
  );
  if (!ticket) return { status: 404, error: "That request isn't in this branch." };
  if (ticket.status === "closed") return { status: 409, error: "This request is closed. Reopen it to reply." };

  const name = String(user.name || user.email || "Support").slice(0, 150);
  const [result] = await db.execute(
    `INSERT INTO support_messages (ticket_id, sender_kind, sender_user_id, sender_name, body)
     VALUES (?, 'staff', ?, ?, ?)`,
    [id, user.userId, name, body]
  );
  await db.execute(
    `UPDATE support_tickets
        SET status = IF(status = 'open', 'in_progress', status),
            assigned_user_id = COALESCE(assigned_user_id, ?),
            assigned_name = COALESCE(assigned_name, ?)
      WHERE ticket_id = ?`,
    [user.userId, name, id]
  );
  if (ticket.status === "open") await settleForTicket(db, id, "in_progress", { userId: user.userId });
  await markRead(id, "staff", result.insertId);
  const [[row]] = await db.execute(`${MESSAGE_SELECT} WHERE message_id = ?`, [result.insertId]);
  const message = messageView(row, true);
  publish(companyId, branchId, { type: "support:message", ticketId: id, message });
  // live on the driver's own socket, so their bell shows the reply as it is sent
  publishToDriver(companyId, ticket.driverId, {
    type: "chat:message", channel: "support", ticketId: id, ticketNo: ticketNo(id),
    messageId: message.id, from: name,
    preview: String(body).replace(/\s+/g, " ").trim().slice(0, 120), at: message.createdAt,
  });
  // the notice says that the office answered, never what it said: a lock screen is public
  void notifyDriver({ companyId, driverId: ticket.driverId, tag: `support-${id}`, title: "The office replied", body: `About your request ${ticketNo(id)}. Open Trackify to read it.` });
  return { message };
}

/** Change where a request stands, and/or take it. Returns { ticket } or { error, status }. */
export async function updateAsStaff({ context, user, id, input }) {
  const { companyId, branchId } = context;
  const [[ticket]] = await db.execute(
    "SELECT ticket_id AS id, status, driver_id AS driverId FROM support_tickets WHERE ticket_id = ? AND company_id = ? AND branch_id = ? LIMIT 1",
    [id, companyId, branchId]
  );
  if (!ticket) return { status: 404, error: "That request isn't in this branch." };

  const sets = [];
  const params = [];
  let next = ticket.status;
  if (input.status != null) {
    if (!STATUSES.includes(input.status)) return { status: 400, error: "That isn't a status a request can have." };
    if (input.status === "resolved" || input.status === "closed") {
      const [[holding]] = await db.execute(
        "SELECT pause_id FROM trip_pauses WHERE ticket_id = ? AND status IN ('pending','approved') LIMIT 1",
        [id]
      );
      if (holding) {
        return { status: 409, error: "This request holds a pause. Approve or decline it, or resume the delivery, rather than closing it here." };
      }
    }
    next = input.status;
    sets.push("status = ?");
    params.push(next);
    if (next === "resolved" || next === "closed") {
      if (ticket.status !== "resolved" && ticket.status !== "closed") sets.push("resolved_at = NOW(3)");
    } else {
      sets.push("resolved_at = NULL");
    }
  }
  if (input.assignToMe) {
    sets.push("assigned_user_id = ?", "assigned_name = ?");
    params.push(user.userId, String(user.name || user.email || "Support").slice(0, 150));
  }
  if (!sets.length) return { status: 400, error: "Nothing to change." };

  await db.execute(`UPDATE support_tickets SET ${sets.join(", ")} WHERE ticket_id = ?`, [...params, id]);
  if (next !== ticket.status) await settleForTicket(db, id, next, { userId: user.userId });
  const result = await getForStaff({ companyId, branchId, id });
  publish(companyId, branchId, {
    type: "support:ticket",
    ticket: { id, ticketNo: ticketNo(id), subject: result.subject, category: result.category, priority: result.priority, status: next, driverName: result.driverName },
  });
  if ((next === "resolved" || next === "closed") && next !== ticket.status) {
    void notifyDriver({ companyId, driverId: ticket.driverId, tag: `support-${id}`, title: next === "resolved" ? "Your request was resolved" : "Your request was closed", body: `${ticketNo(id)}. Open Trackify to see it.` });
  }
  return { ticket: result, from: ticket.status, to: next };
}
