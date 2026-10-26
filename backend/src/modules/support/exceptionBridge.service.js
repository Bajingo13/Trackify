import db from "../../config/db.js";
import * as pauses from "./pause.service.js";
import * as support from "./support.service.js";

/**
 * The Exceptions panel, for exceptions that came from a driver.
 *
 * A driver's pause request, or a concern they filed, is an exception like any
 * other — but unlike a late truck, it has a person behind it with something to
 * decide: approve the pause, decline it, tell them what to do. So from the
 * panel the office can see the report and its evidence, answer a pause, and
 * resolve the exception; and what they do there is done to the pause or the
 * request it came from, which is what keeps the delivery, the driver's app and
 * the customer's page telling the same story.
 *
 * Every function answers { handled, status, body } so the existing handlers can
 * hand over only when an exception has a source and carry on, unchanged, when
 * it does not.
 */

const NOT_HANDLED = { handled: false };
const reply = (status, body) => ({ handled: true, status, body });

/** The exception, and what it came from — within the branch being operated in. */
async function sourceOf({ companyId, branchId }, exceptionId) {
  const [[row]] = await db.execute(
    `SELECT exception_id AS id, status, source_kind AS sourceKind, source_id AS sourceId, trip_ticket_id AS tripId
       FROM operational_exceptions
      WHERE exception_id = ? AND company_id = ? AND branch_id = ? LIMIT 1`,
    [exceptionId, companyId, branchId]
  );
  return row || null;
}

/** The pause behind a pause-sourced exception: its number, its request, where it stands. */
async function pauseOf({ companyId, branchId }, pauseId) {
  const [[row]] = await db.execute(
    "SELECT pause_id AS id, ticket_id AS ticketId, status FROM trip_pauses WHERE pause_id = ? AND company_id = ? AND branch_id = ? LIMIT 1",
    [pauseId, companyId, branchId]
  );
  return row || null;
}

/** A member of staff, as a request's thread names them. */
export async function loadStaffUser(userId, email) {
  const [[me]] = await db.execute(
    "SELECT TRIM(CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, ''))) AS name FROM users WHERE user_id = ?",
    [userId]
  );
  return { userId, email, name: me?.name || email || "Support" };
}

/**
 * What the driver reported, for the detail view of an exception: the pause with
 * its reason, description and photographs, or the request it came from.
 * Answers null for an exception nobody filed.
 */
export async function driverReport(context, exceptionId) {
  const ex = await sourceOf(context, exceptionId);
  if (!ex) return { missing: true };
  if (!ex.sourceKind) return { report: null };

  if (ex.sourceKind === "pause") {
    const link = await pauseOf(context, ex.sourceId);
    if (!link?.ticketId) return { report: null };
    const pause = await pauses.detailForTicket({ ...context, ticketId: link.ticketId });
    return { report: { kind: "pause", ticketId: link.ticketId, pause } };
  }
  // A pre-trip inspection is read and settled in Fleet → Inspections; its id is not a request's.
  if (ex.sourceKind === "inspection") return { report: { kind: "inspection", inspectionId: ex.sourceId } };
  if (ex.sourceKind !== "support") return { report: null };

  const [[ticket]] = await db.execute(
    `SELECT ticket_id AS id, status, subject, category, priority, driver_name AS driverName, assigned_name AS assignedName
       FROM support_tickets WHERE ticket_id = ? AND company_id = ? AND branch_id = ? LIMIT 1`,
    [ex.sourceId, context.companyId, context.branchId]
  );
  if (!ticket) return { report: null };
  return {
    report: {
      kind: "support",
      ticketId: ticket.id,
      ticket: { ...ticket, ticketNo: support.ticketNo(ticket.id) },
    },
  };
}

/** A photograph on the pause behind an exception. */
export async function photo(context, exceptionId, photoId) {
  const ex = await sourceOf(context, exceptionId);
  if (!ex || ex.sourceKind !== "pause") return null;
  const link = await pauseOf(context, ex.sourceId);
  if (!link?.ticketId) return null;
  return pauses.photoForStaff({ ...context, ticketId: link.ticketId, photoId });
}

/** Approve, decline or end the pause behind an exception. */
export async function decide({ context, user, exceptionId, decision, input }) {
  const ex = await sourceOf(context, exceptionId);
  if (!ex) return { status: 404, error: "Exception not found." };
  if (ex.sourceKind !== "pause") return { status: 409, error: "This exception isn't a pause request." };
  const link = await pauseOf(context, ex.sourceId);
  if (!link?.ticketId) return { status: 404, error: "The pause request is missing." };

  const action = decision === "approve" ? pauses.approve : decision === "decline" ? pauses.decline : pauses.resumeAsStaff;
  const result = await action({ context, user, ticketId: link.ticketId, input: input || {} });
  return result.error ? result : { pause: result.pause, ticketId: link.ticketId };
}

/**
 * "Acknowledge" on an exception that came from a driver.
 *
 * A pause request is not acknowledged, it is answered: approving it is what
 * acknowledges the exception, so the panel is told to do that instead.
 */
export async function acknowledge({ context, user, exceptionId }) {
  const ex = await sourceOf(context, exceptionId);
  if (!ex || !ex.sourceKind) return NOT_HANDLED;

  if (ex.sourceKind === "pause") {
    const link = await pauseOf(context, ex.sourceId);
    if (link?.status === "pending") {
      return reply(409, { success: false, message: "This is a driver's pause request. Approve or decline it to answer it." });
    }
    return reply(409, { success: false, message: "Exception cannot be acknowledged." });
  }
  // an inspection is acknowledged like any exception; only a request has a driver to tell
  if (ex.sourceKind !== "support") return NOT_HANDLED;

  // A concern from Help & Support: taking it on, which also tells the driver it is being handled.
  const result = await support.updateAsStaff({
    context, user, id: ex.sourceId, input: { status: "in_progress", assignToMe: true },
  });
  if (result.error) return reply(result.status, { success: false, message: result.error });
  return reply(200, { success: true, message: "Exception acknowledged." });
}

/**
 * "Resolve" on an exception that came from a driver. An approved pause ends —
 * the delivery resumes — and a concern is answered and closed out; in both the
 * driver is told, in the thread, in the notes the office wrote.
 */
export async function resolve({ context, user, exceptionId, notes }) {
  const ex = await sourceOf(context, exceptionId);
  if (!ex || !ex.sourceKind) return NOT_HANDLED;

  if (ex.sourceKind === "pause") {
    const link = await pauseOf(context, ex.sourceId);
    if (!link) return reply(404, { success: false, message: "Exception does not exist or is already resolved." });
    if (link.status === "pending") {
      return reply(409, { success: false, message: "The driver is waiting for an answer. Approve or decline the pause request first." });
    }
    if (link.status !== "approved") {
      return reply(409, { success: false, message: "Exception does not exist or is already resolved." });
    }
    const result = await pauses.resumeAsStaff({ context, user, ticketId: link.ticketId, input: { note: notes } });
    if (result.error) return reply(result.status, { success: false, message: result.error });
    return reply(200, { success: true, message: "Exception resolved. The delivery has resumed." });
  }
  /*
   * Closing it here would leave the trip held: what lets a trip go after a
   * failed inspection is Fleet approving departure, which settles this
   * exception itself.
   */
  if (ex.sourceKind === "inspection") {
    return reply(409, {
      success: false,
      message: "This came from a pre-trip inspection. Settle it in Fleet → Inspections: approve departure, or mark it reviewed.",
    });
  }
  if (ex.sourceKind !== "support") return NOT_HANDLED;

  const said = await support.replyAsStaff({ context, user, id: ex.sourceId, input: { body: notes } });
  // a request already closed cannot be written on; it can still be settled below
  if (said.error && said.status !== 409) return reply(said.status, { success: false, message: said.error });
  const closed = await support.updateAsStaff({ context, user, id: ex.sourceId, input: { status: "resolved" } });
  if (closed.error && closed.status !== 400) return reply(closed.status, { success: false, message: closed.error });
  return reply(200, { success: true, message: "Exception resolved." });
}

/**
 * The conversation behind a driver's exception. Reading it marks the driver's
 * words as read by the office, the way opening a message does.
 */
export async function thread(context, exceptionId) {
  const ex = await sourceOf(context, exceptionId);
  if (!ex) return { missing: true };
  if (!ex.sourceKind) return { thread: null };
  // only a pause or a request has a conversation behind it
  if (ex.sourceKind !== "pause" && ex.sourceKind !== "support") return { thread: null };

  let ticketId = ex.sourceId;
  if (ex.sourceKind === "pause") {
    const link = await pauseOf(context, ex.sourceId);
    if (!link?.ticketId) return { thread: null };
    ticketId = link.ticketId;
  }
  const ticket = await support.getForStaff({ companyId: context.companyId, branchId: context.branchId, id: ticketId });
  if (!ticket) return { thread: null };
  return {
    thread: {
      ticketId: ticket.id,
      ticketNo: ticket.ticketNo,
      status: ticket.status,
      driverName: ticket.driverName,
      messages: ticket.messages,
    },
  };
}

/** Write to the driver on the request behind an exception. Returns { message } or { error, status }. */
export async function replyToDriver({ context, user, exceptionId, body }) {
  const ex = await sourceOf(context, exceptionId);
  if (!ex) return { status: 404, error: "Exception not found." };
  if (!ex.sourceKind) return { status: 409, error: "This exception did not come from a driver, so there is nobody to write to." };
  if (ex.sourceKind !== "pause" && ex.sourceKind !== "support") {
    return { status: 409, error: "This came from a pre-trip inspection, which has no conversation with the driver." };
  }

  let ticketId = ex.sourceId;
  if (ex.sourceKind === "pause") {
    const link = await pauseOf(context, ex.sourceId);
    if (!link?.ticketId) return { status: 404, error: "The driver's request is missing." };
    ticketId = link.ticketId;
  }
  return support.replyAsStaff({ context, user, id: ticketId, input: { body } });
}
