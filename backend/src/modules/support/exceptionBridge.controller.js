import { recordAudit } from "../../shared/audit.js";
import { fileExists, streamFile, toAbsolute } from "../finance/receipts.storage.js";
import * as bridge from "./exceptionBridge.service.js";

/**
 * The Exceptions panel's view of a driver's report. Mounted under
 * /api/v1/operations/exceptions, so everything here is for the operating branch
 * and needs the exception permissions — not the support ones: the people who
 * work the exception board are the ones who answer what is on it.
 */

const idOf = (req, name = "id") => {
  const id = Number(req.params[name]);
  return Number.isInteger(id) && id > 0 ? id : null;
};

/* GET /api/v1/operations/exceptions/:id/driver-report */
export async function report(req, res) {
  const exceptionId = idOf(req);
  const result = exceptionId ? await bridge.driverReport(req.context, exceptionId) : { missing: true };
  if (result.missing) return res.status(404).json({ success: false, message: "Exception not found." });
  res.json({ success: true, data: result.report });
}

/* GET /api/v1/operations/exceptions/:id/driver-report/photos/:photoId */
export async function photo(req, res) {
  const exceptionId = idOf(req);
  const photoId = idOf(req, "photoId");
  const found = exceptionId && photoId ? await bridge.photo(req.context, exceptionId, photoId) : null;
  if (!found || !fileExists(found.path)) {
    return res.status(404).json({ success: false, message: "There is no such photo." });
  }
  res.type(found.mime);
  res.setHeader("Cache-Control", "private, max-age=86400");
  return streamFile(res, toAbsolute(found.path));
}

/* POST /api/v1/operations/exceptions/:id/pause/approve | decline | resume */
const decision = (verb) => async (req, res) => {
  const exceptionId = idOf(req);
  if (!exceptionId) return res.status(404).json({ success: false, message: "Exception not found." });
  const user = await bridge.loadStaffUser(req.user.userId, req.user.email);
  const result = await bridge.decide({
    context: req.context, user, exceptionId, decision: verb, input: req.body || {},
  });
  if (result.error) return res.status(result.status).json({ success: false, message: result.error });
  await recordAudit(req, {
    module: "support",
    action: `pause.${verb}`,
    entityType: "trip_pause",
    entityId: result.pause.id,
    summary: `${result.pause.tripNo} pause ${verb} by ${user.name} (from the Exceptions panel)`,
  });
  res.json({ success: true, data: result.pause });
};
export const approve = decision("approve");
export const decline = decision("decline");
export const resume = decision("resume");

/* GET /api/v1/operations/exceptions/:id/driver-report/thread */
export async function thread(req, res) {
  const exceptionId = idOf(req);
  const result = exceptionId ? await bridge.thread(req.context, exceptionId) : { missing: true };
  if (result.missing) return res.status(404).json({ success: false, message: "Exception not found." });
  res.json({ success: true, data: result.thread });
}

/* POST /api/v1/operations/exceptions/:id/driver-report/reply  { body } */
export async function reply(req, res) {
  const exceptionId = idOf(req);
  if (!exceptionId) return res.status(404).json({ success: false, message: "Exception not found." });
  const user = await bridge.loadStaffUser(req.user.userId, req.user.email);
  const result = await bridge.replyToDriver({ context: req.context, user, exceptionId, body: req.body?.body });
  if (result.error) return res.status(result.status).json({ success: false, message: result.error });
  res.status(201).json({ success: true, data: result.message });
}
