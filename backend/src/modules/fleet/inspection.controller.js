import fsSync from "node:fs";
import { recordAudit } from "../../shared/audit.js";
import { publishToDriver } from "../../realtime/hub.js";
import { discard, streamFile, toAbsolute } from "../finance/receipts.storage.js";
import * as inspections from "./inspection.service.js";

/**
 * Pre-trip inspections over HTTP: the driver files one from the Driver App;
 * the Fleet team reads them and settles the failed ones (inspection.service.js).
 */

const refuse = (res, e) =>
  res.status(e.status).json({ success: false, message: e.message, ...(e.code ? { code: e.code } : {}) });

/* POST /api/v1/driver/trips/:id/inspection  multipart: answers, photoItems, photos[], confirmed, clientRef, ageMs, lat?, lng?, notes? */
export async function driverCreate(req, res) {
  const files = req.files || [];
  const tripId = Number(req.params.id);
  let result;
  try {
    result = await inspections.createForDriver({ driver: req.driver, tripId, input: req.body || {}, files });
  } catch (e) {
    files.forEach((file) => discard(file.path));
    if (e?.status) return refuse(res, e);
    throw e;
  }
  // sent again: already on file, so these copies of the photos are not needed
  if (result.duplicate) {
    files.forEach((file) => discard(file.path));
    return res.json({ success: true, data: result.inspection, duplicate: true });
  }

  const { inspection } = result;
  // audited under the trip's branch, like every other step a driver takes on a trip
  req.context = { ...req.context, companyId: req.driver.companyId, branchId: result.branchId };
  await recordAudit(req, {
    module: "driver-app",
    action: "inspection.submit",
    entityType: "trip_ticket",
    entityId: tripId,
    summary: `Driver ${req.driver.name}: pre-trip inspection ${inspection.result.replace(/_/g, " ")}`,
  });
  // A failed one is already an exception (inspection.service.js), which the
  // Exceptions panel shows on its next refresh.
  res.status(201).json({ success: true, data: inspection });
}

/* GET /api/v1/fleet/inspections?status=pending|failed|all */
export async function list(req, res) {
  const status = ["pending", "failed", "all"].includes(req.query.status) ? req.query.status : "pending";
  const rows = await inspections.listForOffice({ companyId: req.context.companyId, status, limit: req.query.limit });
  res.json({ success: true, data: rows });
}

/* GET /api/v1/fleet/inspections/:id */
export async function get(req, res) {
  const row = await inspections.getForOffice({ companyId: req.context.companyId, id: Number(req.params.id) });
  if (!row) return res.status(404).json({ success: false, message: "Inspection not found." });
  res.json({ success: true, data: row });
}

/* GET /api/v1/fleet/inspections/:id/photos/:photoId */
export async function photo(req, res) {
  const p = await inspections.photoForOffice({
    companyId: req.context.companyId, id: Number(req.params.id), photoId: Number(req.params.photoId),
  });
  if (!p?.path) return res.status(404).json({ success: false, message: "Photo not found." });
  const abs = toAbsolute(p.path);
  if (!fsSync.existsSync(abs)) return res.status(404).json({ success: false, message: "The photo file is missing." });
  res.set("Cache-Control", "private, no-store");
  res.type(p.mime);
  streamFile(res, abs);
}

/* POST /api/v1/fleet/inspections/:id/approve-departure  { reason } */
export async function approveDeparture(req, res) {
  const id = Number(req.params.id);
  let done;
  try {
    done = await inspections.approveDeparture({
      companyId: req.context.companyId, id, userId: req.context.userId, reason: req.body?.reason,
    });
  } catch (e) {
    if (e?.status) return refuse(res, e);
    throw e;
  }
  await recordAudit(req, {
    module: "fleet",
    action: "inspection.approve_departure",
    entityType: "trip_ticket",
    entityId: done.tripId,
    summary: `Approved departure after a failed pre-trip inspection: ${String(req.body.reason).trim().slice(0, 200)}`,
    metadata: { inspectionId: id },
  });
  // the driver's screen unlocks Start without waiting for its next refresh
  publishToDriver(req.context.companyId, done.driverId, { type: "trip:inspection", tripId: done.tripId, approved: true });
  res.json({ success: true, data: { id, approved: true } });
}

/* POST /api/v1/fleet/inspections/:id/review  { note? } */
export async function review(req, res) {
  const id = Number(req.params.id);
  try {
    await inspections.markReviewed({ companyId: req.context.companyId, id, userId: req.context.userId, note: req.body?.note });
  } catch (e) {
    if (e?.status) return refuse(res, e);
    throw e;
  }
  await recordAudit(req, {
    module: "fleet",
    action: "inspection.review",
    entityType: "vehicle_inspection",
    entityId: id,
    summary: "Reviewed a pre-trip inspection issue",
  });
  res.json({ success: true, data: { id, reviewed: true } });
}
