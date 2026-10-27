import { recordAudit } from "../../shared/audit.js";
import { publish } from "../../realtime/hub.js";
import { discard } from "../finance/receipts.storage.js";
import * as bridge from "../support/exceptionBridge.service.js";
import { runTransition } from "./trip-status.service.js";
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

/* ---------------------------------------------------------------- */
/* The office, from the Exceptions panel                            */
/* ---------------------------------------------------------------- */

/** The report behind the exception in the URL, or an answer saying why there is none. */
async function reportFor(req, res) {
  const exceptionId = Number(req.params.id);
  const found = Number.isInteger(exceptionId) && exceptionId > 0 ? await bridge.deliveryReportOf(req.context, exceptionId) : { missing: true };
  if (found.missing) {
    res.status(404).json({ success: false, message: "Exception not found." });
    return null;
  }
  if (!found.reportId) {
    res.status(409).json({ success: false, message: "This exception isn't a delivery report." });
    return null;
  }
  return found.reportId;
}

/* POST /api/v1/operations/exceptions/:id/delivery-report/reattempt  { note? } */
export async function officeReattempt(req, res) {
  const reportId = await reportFor(req, res);
  if (!reportId) return;
  const user = await bridge.loadStaffUser(req.context.userId, req.user?.email);
  let result;
  try {
    result = await reports.reattemptAsStaff({ context: req.context, user, reportId, note: req.body?.note });
  } catch (e) {
    if (e?.status) return refuse(res, e);
    throw e;
  }
  await recordAudit(req, {
    module: "operations",
    action: "delivery.reattempt",
    entityType: "trip_ticket",
    entityId: result.tripId,
    summary: `Asked for another delivery attempt (from the Exceptions panel)`,
  });
  publish(req.context.companyId, req.context.branchId, { type: "trip:delivery-report", tripId: result.tripId, report: { id: reportId, status: "reattempt" } });
  res.json({ success: true, message: "The driver has been asked to try again.", data: result });
}

/*
 * POST /api/v1/operations/exceptions/:id/delivery-report/return  { note? }
 *
 * The load comes back: the trip moves to "returned" through the same
 * transition every status change goes through (history, audit, the truck and
 * driver freed, any pause ended), with the report settled inside it.
 */
export async function officeReturn(req, res) {
  const reportId = await reportFor(req, res);
  if (!reportId) return;
  let report;
  try {
    report = await reports.checkReturnable({ ...req.context, reportId });
  } catch (e) {
    if (e?.status) return refuse(res, e);
    throw e;
  }
  const note = String(req.body?.note || "").trim().slice(0, 1000);
  let settled = null;
  await runTransition(req, res, "return", `Returned undelivered${note ? `: ${note}` : ""}`, {
    tripId: report.tripId,
    beforeCommit: async (conn) => {
      settled = await reports.settleAsReturned(conn, { ...req.context, reportId, userId: req.context.userId, note });
    },
  });
  // only once the transition has committed (it answers the request itself)
  if (settled) reports.announceReturned({ companyId: req.context.companyId, report: settled, note });
}
