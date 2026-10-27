import fsSync from "node:fs";
import { recordAudit } from "../../shared/audit.js";
import { discard, streamFile, toAbsolute } from "../finance/receipts.storage.js";
import * as odometer from "./odometer.service.js";

/**
 * Odometer readings over HTTP: the driver records the start and end of a trip
 * from the Driver App; the Fleet team reads them and corrects a wrong one
 * (odometer.service.js).
 */

const refuse = (res, e) =>
  res.status(e.status).json({ success: false, message: e.message, ...(e.code ? { code: e.code } : {}) });

/* POST /api/v1/driver/trips/:id/odometer  multipart: kind, valueKm, clientRef, ageMs, photo? */
export async function driverCreate(req, res) {
  const file = req.file || null;
  const tripId = Number(req.params.id);
  let result;
  try {
    result = await odometer.createForDriver({ driver: req.driver, tripId, input: req.body || {}, file });
  } catch (e) {
    if (file) discard(file.path);
    if (e?.status) return refuse(res, e);
    throw e;
  }
  if (result.duplicate) {
    if (file) discard(file.path);
    return res.json({ success: true, data: result.reading, duplicate: true });
  }
  // audited under the trip's branch, like every other step a driver takes on a trip
  req.context = { ...req.context, companyId: req.driver.companyId, branchId: result.branchId };
  await recordAudit(req, {
    module: "driver-app",
    action: `odometer.${result.reading.kind}`,
    entityType: "trip_ticket",
    entityId: tripId,
    summary: `Driver ${req.driver.name}: ${result.reading.kind} odometer ${result.reading.valueKm} km`,
  });
  res.status(201).json({ success: true, data: result.reading, ...(result.warning ? { warning: result.warning } : {}) });
}

/* GET /api/v1/fleet/trips/:id/odometer */
export async function forTrip(req, res) {
  const data = await odometer.readingsForOffice({ companyId: req.context.companyId, tripId: Number(req.params.id) });
  if (!data) return res.status(404).json({ success: false, message: "Trip not found." });
  res.json({ success: true, data });
}

/* GET /api/v1/fleet/odometer-readings/:id/photo */
export async function photo(req, res) {
  const p = await odometer.photoForOffice({ companyId: req.context.companyId, id: Number(req.params.id) });
  if (!p) return res.status(404).json({ success: false, message: "No photo for this reading." });
  const abs = toAbsolute(p.path);
  if (!fsSync.existsSync(abs)) return res.status(404).json({ success: false, message: "The photo file is missing." });
  res.set("Cache-Control", "private, no-store");
  res.type(p.mime);
  streamFile(res, abs);
}

/* POST /api/v1/fleet/odometer-readings/:id/correct  { valueKm, reason } */
export async function correct(req, res) {
  const id = Number(req.params.id);
  let done;
  try {
    done = await odometer.correctReading({
      companyId: req.context.companyId, id, userId: req.context.userId,
      valueKm: req.body?.valueKm, reason: req.body?.reason,
    });
  } catch (e) {
    if (e?.status) return refuse(res, e);
    throw e;
  }
  await recordAudit(req, {
    module: "fleet",
    action: "odometer.correct",
    entityType: "trip_ticket",
    entityId: done.tripId,
    summary: `Corrected the ${done.kind} odometer reading: ${done.from} → ${done.to} km. ${String(req.body.reason).trim().slice(0, 200)}`,
    metadata: { readingId: id, from: done.from, to: done.to },
  });
  res.json({ success: true, data: { id, correctedValueKm: done.to } });
}
