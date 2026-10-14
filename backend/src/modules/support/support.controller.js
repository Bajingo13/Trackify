import { recordAudit } from "../../shared/audit.js";
import * as support from "./support.service.js";
import * as pauses from "./pause.service.js";

/**
 * Driver Help & Support, from the Driver App. The rules live in
 * support.service.js; this only turns requests into calls and answers into JSON.
 *
 * Mounted at /api/v1/driver/support. Nothing here takes a driver id: every
 * handler is the signed-in driver's own, which is what stops one driver reading
 * another's. The office answers through the Exceptions panel, where a driver's
 * report is an exception like any other — see exceptionBridge.controller.js.
 */

const idOf = (req) => {
  const id = Number(req.params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
};
const fail = (res, { status, error }) => res.status(status).json({ success: false, message: error });

/* GET /api/v1/driver/support */
export async function driverList(req, res) {
  const tickets = await support.listForDriver(req.driver);
  res.json({ success: true, data: tickets });
}

/* GET /api/v1/driver/support/unread */
export async function driverUnread(req, res) {
  res.json({ success: true, data: { unread: await support.unreadForDriver(req.driver) } });
}

/* POST /api/v1/driver/support  { category, subject, message, tripId?, urgent?, clientRef } */
export async function driverCreate(req, res) {
  const result = await support.createForDriver({ driver: req.driver, input: req.body || {} });
  if (result.error) return fail(res, result);
  if (!result.duplicate) {
    await recordAudit(req, {
      module: "support",
      action: "ticket.create",
      entityType: "support_ticket",
      entityId: result.ticket.id,
      summary: `${req.driver.name} filed ${result.ticket.ticketNo}: ${result.ticket.subject}`,
    });
  }
  res.status(result.duplicate ? 200 : 201).json({ success: true, data: result.ticket });
}

/* GET /api/v1/driver/support/:id — a request with its thread, and its pause if it has one */
export async function driverGet(req, res) {
  const id = idOf(req);
  const ticket = id ? await support.getForDriver({ driver: req.driver, id }) : null;
  if (!ticket) return res.status(404).json({ success: false, message: "That request isn't yours." });
  const pause = ticket.pause ? await pauses.getForDriver({ driver: req.driver, id: ticket.pause.id }) : null;
  res.json({ success: true, data: { ...ticket, pause } });
}

/* POST /api/v1/driver/support/:id/reopen */
export async function driverReopen(req, res) {
  const id = idOf(req);
  if (!id) return res.status(404).json({ success: false, message: "That request isn't yours." });
  const result = await support.reopenForDriver({ driver: req.driver, id });
  if (result.error) return fail(res, result);
  await recordAudit(req, {
    module: "support",
    action: "ticket.reopen",
    entityType: "support_ticket",
    entityId: id,
    summary: `${req.driver.name} reopened ${support.ticketNo(id)}`,
  });
  const ticket = await support.getForDriver({ driver: req.driver, id });
  res.json({ success: true, data: ticket });
}

/* POST /api/v1/driver/support/:id/messages  { body, clientRef } */
export async function driverReply(req, res) {
  const id = idOf(req);
  if (!id) return res.status(404).json({ success: false, message: "That request isn't yours." });
  const result = await support.replyAsDriver({ driver: req.driver, id, input: req.body || {} });
  if (result.error) return fail(res, result);
  res.status(result.duplicate ? 200 : 201).json({ success: true, data: result.message });
}
