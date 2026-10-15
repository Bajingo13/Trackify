import db from "../../config/db.js";
import {
  checkBody, checkCaption, checkClientRef, driverUnread, findPhoto, isClosed, listMessages, markRead,
  postMessage, staffUnread,
} from "./tripChat.service.js";
import { discard, streamFile, toAbsolute, toRelative } from "../finance/receipts.storage.js";

/**
 * Trip chat, both ends.
 *
 * A driver reaches only a trip currently assigned to them. Staff reach only a
 * trip in their operating branch, the same rule as every other trip screen.
 * Past that point both sides behave the same: see tripChat.service.js.
 */

/* What either side is shown about a message. Internal account ids stay home. */
const view = (message, mine) => ({
  id: message.id,
  tripId: message.tripId,
  senderKind: message.senderKind,
  senderName: message.senderName,
  body: message.body,
  clientRef: message.clientRef,
  createdAt: message.createdAt,
  hasPhoto: Boolean(message.hasPhoto),
  mine,
});

const tripId = (req) => {
  const id = Number(req.params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const closedMessage = "This trip is closed, so its chat can be read but not added to.";

/**
 * Send one message's photo. The lookup is by trip AND message, and the trip was
 * already proven to be this caller's, so a message id from another trip — or
 * another company — finds nothing.
 */
async function sendPhoto(req, res, trip) {
  const photo = await findPhoto(trip.tripId, req.params.messageId);
  if (!photo) return res.status(404).json({ success: false, message: "There is no photo on that message." });
  res.type(photo.mime);
  // A stored photo never changes, so the phone or browser may keep it.
  res.setHeader("Cache-Control", "private, max-age=86400");
  return streamFile(res, toAbsolute(photo.path));
}

/* ---------------------------------------------------------------- */
/* Driver App                                                       */
/* ---------------------------------------------------------------- */

async function driverTrip(req) {
  const id = tripId(req);
  if (!id) return null;
  const [[trip]] = await db.execute(
    `SELECT tt.trip_ticket_id AS tripId, tt.company_id AS companyId, tt.branch_id AS branchId,
            tt.status, tt.ticket_no AS ticketNo
       FROM trip_assignments ta
       JOIN trip_tickets tt ON tt.trip_ticket_id = ta.trip_ticket_id
      WHERE ta.driver_id = ? AND ta.is_current = TRUE
        AND tt.company_id = ? AND tt.trip_ticket_id = ? LIMIT 1`,
    [req.driver.driverId, req.driver.companyId, id]
  );
  return trip || null;
}

const driverMine = (message, req) => message.senderKind === "driver" && message.senderDriverId === req.driver.driverId;

/* GET /api/v1/driver/trips/:id/messages?after= */
export async function driverList(req, res) {
  const trip = await driverTrip(req);
  if (!trip) return res.status(404).json({ success: false, message: "That trip isn't assigned to you." });
  const messages = await listMessages(trip.tripId, { after: req.query.after });
  res.json({
    success: true,
    data: { messages: messages.map((m) => view(m, driverMine(m, req))), closed: isClosed(trip.status) },
  });
}

/* POST /api/v1/driver/trips/:id/messages  { body, clientRef } */
export async function driverSend(req, res) {
  const trip = await driverTrip(req);
  if (!trip) return res.status(404).json({ success: false, message: "That trip isn't assigned to you." });
  if (isClosed(trip.status)) return res.status(409).json({ success: false, message: closedMessage });
  const { body, error } = checkBody(req.body?.body);
  if (error) return res.status(400).json({ success: false, message: error });

  const { message, duplicate } = await postMessage({
    companyId: trip.companyId,
    branchId: trip.branchId,
    tripId: trip.tripId,
    senderKind: "driver",
    senderDriverId: req.driver.driverId,
    senderName: req.driver.name,
    body,
    clientRef: checkClientRef(req.body?.clientRef),
  });
  res.status(duplicate ? 200 : 201).json({ success: true, data: view(message, true) });
}

/*
 * POST /api/v1/driver/trips/:id/messages/photo  multipart: photo, body?, clientRef
 *
 * A photo for dispatch — proof of delivery, a receipt, damage to the truck. The
 * words are optional. Everything else about it is a message like any other:
 * same thread, same replay protection, same read-only rule once the trip closes.
 */
export async function driverSendPhoto(req, res) {
  const file = req.file || null;
  const bail = (status, message) => {
    if (file) discard(file.path);
    return res.status(status).json({ success: false, message });
  };

  const trip = await driverTrip(req);
  if (!trip) return bail(404, "That trip isn't assigned to you.");
  if (isClosed(trip.status)) return bail(409, closedMessage);
  if (!file) return bail(400, "Choose a photo to send.");
  const { caption, error } = checkCaption(req.body?.body);
  if (error) return bail(400, error);

  let result;
  try {
    result = await postMessage({
      companyId: trip.companyId,
      branchId: trip.branchId,
      tripId: trip.tripId,
      senderKind: "driver",
      senderDriverId: req.driver.driverId,
      senderName: req.driver.name,
      body: caption,
      clientRef: checkClientRef(req.body?.clientRef),
      photo: { path: toRelative(file.path), mime: file.mimetype, size: file.size },
    });
  } catch (err) {
    discard(file.path);
    throw err;
  }
  // A replayed send finds the message already stored with its first copy of the photo.
  if (result.duplicate) discard(file.path);
  res.status(result.duplicate ? 200 : 201).json({ success: true, data: view(result.message, true) });
}

/* GET /api/v1/driver/trips/:id/messages/:messageId/photo */
export async function driverPhoto(req, res) {
  const trip = await driverTrip(req);
  if (!trip) return res.status(404).json({ success: false, message: "That trip isn't assigned to you." });
  return sendPhoto(req, res, trip);
}

/* POST /api/v1/driver/trips/:id/messages/read  { lastMessageId } */
export async function driverRead(req, res) {
  const trip = await driverTrip(req);
  if (!trip) return res.status(404).json({ success: false, message: "That trip isn't assigned to you." });
  await markRead({
    tripId: trip.tripId, readerKind: "driver", readerId: req.driver.driverId, lastMessageId: req.body?.lastMessageId,
  });
  res.json({ success: true });
}

/* GET /api/v1/driver/messages/unread */
export async function driverUnreadSummary(req, res) {
  const rows = await driverUnread({ driverId: req.driver.driverId, companyId: req.driver.companyId });
  res.json({ success: true, data: rows });
}

/* ---------------------------------------------------------------- */
/* Dispatch (web)                                                   */
/* ---------------------------------------------------------------- */

async function staffTrip(req) {
  const id = tripId(req);
  if (!id) return null;
  const { companyId, branchId } = req.context;
  const [[trip]] = await db.execute(
    `SELECT tt.trip_ticket_id AS tripId, tt.company_id AS companyId, tt.branch_id AS branchId,
            tt.status, tt.ticket_no AS ticketNo,
            ta.driver_id AS driverId,
            TRIM(CONCAT(COALESCE(d.first_name, ''), ' ', COALESCE(d.last_name, ''))) AS driverName
       FROM trip_tickets tt
       LEFT JOIN trip_assignments ta ON ta.trip_ticket_id = tt.trip_ticket_id AND ta.is_current = TRUE
       LEFT JOIN drivers d ON d.driver_id = ta.driver_id
      WHERE tt.trip_ticket_id = ? AND tt.company_id = ? AND tt.branch_id = ? LIMIT 1`,
    [id, companyId, branchId]
  );
  return trip || null;
}

const staffMine = (message, req) => message.senderKind === "staff" && message.senderUserId === req.user.userId;

/* GET /api/v1/operations/chat/trips/:id?after= */
export async function staffList(req, res) {
  const trip = await staffTrip(req);
  if (!trip) return res.status(404).json({ success: false, message: "Trip not found in this branch." });
  const messages = await listMessages(trip.tripId, { after: req.query.after });
  res.json({
    success: true,
    data: {
      messages: messages.map((m) => view(m, staffMine(m, req))),
      closed: isClosed(trip.status),
      ticketNo: trip.ticketNo,
      driver: trip.driverId ? { name: trip.driverName || "Driver" } : null,
    },
  });
}

/* POST /api/v1/operations/chat/trips/:id  { body, clientRef } */
export async function staffSend(req, res) {
  const trip = await staffTrip(req);
  if (!trip) return res.status(404).json({ success: false, message: "Trip not found in this branch." });
  if (isClosed(trip.status)) return res.status(409).json({ success: false, message: closedMessage });
  if (!trip.driverId) {
    return res.status(409).json({ success: false, message: "No driver is assigned to this trip yet, so there is nobody to message." });
  }
  const { body, error } = checkBody(req.body?.body);
  if (error) return res.status(400).json({ success: false, message: error });

  const [[me]] = await db.execute(
    "SELECT TRIM(CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, ''))) AS name FROM users WHERE user_id = ?",
    [req.user.userId]
  );
  const { message, duplicate } = await postMessage({
    companyId: trip.companyId,
    branchId: trip.branchId,
    tripId: trip.tripId,
    senderKind: "staff",
    senderUserId: req.user.userId,
    senderName: me?.name || "Dispatch",
    body,
    clientRef: checkClientRef(req.body?.clientRef),
  });
  res.status(duplicate ? 200 : 201).json({ success: true, data: view(message, true) });
}

/* GET /api/v1/operations/chat/trips/:id/messages/:messageId/photo */
export async function staffPhoto(req, res) {
  const trip = await staffTrip(req);
  if (!trip) return res.status(404).json({ success: false, message: "Trip not found in this branch." });
  return sendPhoto(req, res, trip);
}

/* POST /api/v1/operations/chat/trips/:id/read  { lastMessageId } */
export async function staffRead(req, res) {
  const trip = await staffTrip(req);
  if (!trip) return res.status(404).json({ success: false, message: "Trip not found in this branch." });
  await markRead({
    tripId: trip.tripId, readerKind: "staff", readerId: req.user.userId, lastMessageId: req.body?.lastMessageId,
  });
  res.json({ success: true });
}

/* GET /api/v1/operations/chat/unread */
export async function staffUnreadSummary(req, res) {
  const { companyId, branchId } = req.context;
  const rows = await staffUnread({ userId: req.user.userId, companyId, branchId });
  res.json({ success: true, data: rows });
}
