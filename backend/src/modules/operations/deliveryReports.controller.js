import { recordAudit } from "../../shared/audit.js";
import { publish } from "../../realtime/hub.js";
import { discard } from "../finance/receipts.storage.js";
import * as reports from "./deliveryReports.service.js";

const refuse = (res, e) =>
  res.status(e.status).json({ success: false, message: e.message, ...(e.code ? { code: e.code } : {}) });

/*
 * POST /api/v1/driver/trips/:id/delivery-report
 * multipart: clientRef, outcome, reason, note, qtyExpected?, qtyDelivered?, lat?, lng?, ageMs?, photos[]
 */
export async function driverCreate(req, res) {
  const files = req.files || [];
  const tripId = Number(req.params.id);
  let result;
  try {
    result = await reports.createForDriver({ driver: req.driver, tripId, input: req.body || {}, files });
  } catch (e) {
    files.forEach((file) => discard(file.path));
    if (e?.status) return refuse(res, e);
    throw e;
  }
  // sent again: already on file, so these copies of the photos are not needed
  if (result.duplicate) {
    files.forEach((file) => discard(file.path));
    return res.json({ success: true, data: result.report, duplicate: true });
  }

  const { report } = result;
  // audited under the trip's branch, like every other step a driver takes on a trip
  req.context = { ...req.context, companyId: req.driver.companyId, branchId: result.branchId };
  await recordAudit(req, {
    module: "driver-app",
    action: "delivery.report",
    entityType: "trip_ticket",
    entityId: tripId,
    summary: `Driver ${req.driver.name}: ${report.outcome === "not_delivered" ? "not delivered" : "delivered with a problem"} — ${report.reasonLabel}`,
  });
  // the office's trip and exception screens refresh on this
  publish(req.driver.companyId, result.branchId, {
    type: "trip:delivery-report",
    tripId,
    ticketNo: result.ticketNo,
    report: { id: report.id, outcome: report.outcome, reason: report.reason, reasonLabel: report.reasonLabel, status: report.status },
  });
  res.status(201).json({ success: true, data: report });
}
