import { recordAudit } from "../../shared/audit.js";
import { discard, fileExists, streamFile, toAbsolute } from "../finance/receipts.storage.js";
import * as pauses from "./pause.service.js";

/**
 * Pause requests and the customer's tracking link. The rules live in
 * pause.service.js; this turns requests into calls and answers into JSON.
 */

const idOf = (req, name = "id") => {
  const id = Number(req.params[name]);
  return Number.isInteger(id) && id > 0 ? id : null;
};
const fail = (res, { status, error }) => res.status(status).json({ success: false, message: error });

function sendPhoto(res, photo) {
  if (!photo) return res.status(404).json({ success: false, message: "There is no such photo." });
  if (!fileExists(photo.path)) return res.status(404).json({ success: false, message: "The photo file is missing." });
  res.type(photo.mime);
  // a stored photo never changes, and it is a picture of a person's worst hour: private
  res.setHeader("Cache-Control", "private, max-age=86400");
  return streamFile(res, toAbsolute(photo.path));
}

/* ---------------------------------------------------------------- */
/* Driver App                                                       */
/* ---------------------------------------------------------------- */

/* POST /api/v1/driver/trips/:id/pause  multipart: reason, description, photos[], lat?, lng?, clientRef */
export async function driverCreate(req, res) {
  const files = req.files || [];
  const bail = (status, message) => {
    files.forEach((file) => discard(file.path));
    return res.status(status).json({ success: false, message });
  };
  const tripId = idOf(req);
  if (!tripId) return bail(404, "That trip isn't assigned to you.");

  let result;
  try {
    result = await pauses.createForDriver({ driver: req.driver, tripId, input: req.body || {}, files });
  } catch (err) {
    files.forEach((file) => discard(file.path));
    throw err;
  }
  if (result.error) return bail(result.status, result.error);
  // a replay of a request already filed: its photos are already stored, these are copies
  if (result.duplicate) {
    files.forEach((file) => discard(file.path));
  } else {
    await recordAudit(req, {
      module: "support",
      action: "pause.request",
      entityType: "trip_pause",
      entityId: result.pause.id,
      summary: `${req.driver.name} asked to pause ${result.pause.tripNo}: ${result.pause.reasonLabel}`,
    });
  }
  res.status(result.duplicate ? 200 : 201).json({ success: true, data: result.pause });
}

/* GET /api/v1/driver/trips/:id/pause — the pause waiting or in force, or null */
export async function driverActive(req, res) {
  const tripId = idOf(req);
  const active = tripId ? await pauses.activeForDriverTrip({ driver: req.driver, tripId }) : null;
  res.json({ success: true, data: { active } });
}

/* POST /api/v1/driver/trips/:id/pause/withdraw | resume */
const driverEnd = (action) => async (req, res) => {
  const tripId = idOf(req);
  if (!tripId) return res.status(404).json({ success: false, message: "That trip isn't assigned to you." });
  const result = await action({ driver: req.driver, tripId });
  if (result.error) return fail(res, result);
  res.json({ success: true, data: result.pause });
};
export const driverWithdraw = driverEnd(pauses.withdrawAsDriver);
export const driverResume = driverEnd(pauses.resumeAsDriver);

/* GET /api/v1/driver/pauses — every pause this driver has asked for */
export async function driverHistory(req, res) {
  res.json({ success: true, data: await pauses.listForDriver({ driver: req.driver }) });
}

/* GET /api/v1/driver/pauses/:id/photos/:photoId */
export async function driverPhoto(req, res) {
  const pauseId = idOf(req);
  const photoId = idOf(req, "photoId");
  const photo = pauseId && photoId ? await pauses.photoForDriver({ driver: req.driver, pauseId, photoId }) : null;
  return sendPhoto(res, photo);
}

/* ---------------------------------------------------------------- */
/* The customer's tracking link                                      */
/* ---------------------------------------------------------------- */

/* POST /api/v1/operations/trips/:id/tracking-link — the active link, or a new one */
export async function linkGet(req, res) {
  const tripId = idOf(req);
  const result = tripId
    ? await pauses.linkForTrip({ context: req.context, user: { userId: req.user.userId }, tripId })
    : { status: 404, error: "Trip not found in this branch." };
  if (result.error) return fail(res, result);
  if (result.created) {
    await recordAudit(req, {
      module: "operations", action: "tracking_link.create", entityType: "trip_ticket", entityId: tripId,
      summary: "Customer tracking link created",
    });
  }
  res.status(result.created ? 201 : 200).json({
    success: true,
    data: {
      token: result.link.token,
      path: `/track/${result.link.token}`,
      expiresAt: result.link.expiresAt,
      viewCount: result.link.viewCount,
      lastViewedAt: result.link.lastViewedAt,
    },
  });
}

/* DELETE /api/v1/operations/trips/:id/tracking-link — stop the link working */
export async function linkRevoke(req, res) {
  const tripId = idOf(req);
  if (!tripId) return res.status(404).json({ success: false, message: "Trip not found in this branch." });
  const { revoked } = await pauses.revokeLinks({ context: req.context, tripId });
  if (revoked) {
    await recordAudit(req, {
      module: "operations", action: "tracking_link.revoke", entityType: "trip_ticket", entityId: tripId,
      summary: "Customer tracking link revoked",
    });
  }
  res.json({ success: true, data: { revoked } });
}

/* ---------------------------------------------------------------- */
/* The customer's page — no sign-in; the link is the credential      */
/* ---------------------------------------------------------------- */

/* GET /api/public/track/:token */
export async function publicTrack(req, res) {
  res.set({
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
    "Referrer-Policy": "no-referrer",
  });
  const result = await pauses.publicView(req.params.token);
  // Unknown, revoked and expired are one answer: a guessed token learns nothing.
  if (result.gone) return res.status(404).json({ success: false, message: "This tracking link is no longer available." });
  res.json({ success: true, data: result.view });
}
