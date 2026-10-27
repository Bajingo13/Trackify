import { get, getDataUrl, post } from "../apiClient";

const exceptionTypes = {
  trip_delay: "Trip Delay",
  route_deviation: "Route Deviation",
  gps_offline: "GPS Offline",
  vehicle_breakdown: "Vehicle Breakdown",
  driver_declined: "Driver Declined",
  failed_delivery: "Failed Delivery",
  cargo_shortage: "Cargo Shortage",
  cargo_damage: "Cargo Damage",
  missing_pod: "Missing POD",
  schedule_conflict: "Schedule Conflict",
  vehicle_maintenance_block: "Vehicle Maintenance Block",
  driver_license_issue: "Driver License Issue",
  // reported by a driver from the Driver app
  driver_emergency: "Driver Emergency",
  driver_incident: "Driver Incident",
  driver_concern: "Driver Concern",
  // from the driver's pre-trip inspection
  vehicle_inspection_failed: "Inspection Failed",
  vehicle_inspection_issue: "Inspection Issue",
};

function mapException(row) {
  if (!row) return row;

  const coordinates =
    row.latitude != null && row.longitude != null
      ? `${Number(row.latitude).toFixed(4)}, ${Number(row.longitude).toFixed(4)}`
      : null;

  return {
    id: row.exception_id,
    tripTicketId: row.trip_ticket_id ?? null,
    tripTicket: row.ticket_no || null,
    type: row.exception_type,
    severity: row.severity,
    title: row.title,
    description: row.description || "No description provided.",
    location:
      coordinates ||
      (row.origin && row.destination ? `${row.origin} → ${row.destination}` : "Not recorded"),
    driver: row.driver_name?.trim() || null,
    vehicle: row.plate_no || null,
    status: row.status,
    detectedAt: row.detected_at,
    acknowledgedAt: row.acknowledged_at,
    resolvedAt: row.resolved_at,
    resolutionNotes: row.resolution_notes,
    // set when a driver filed this from the Driver app: "pause" or "support"
    sourceKind: row.source_kind || null,
    sourceId: row.source_id ?? null,
    // when the driver's last word was sent, if the office has not answered it yet
    awaitingSince: row.awaiting_since || null,
  };
}

/**
 * How long a driver has been waiting for the office, and how worried to be about it:
 * { text: "2 h 10 min", tone: "new" | "late" | "overdue" }. A critical report is
 * overdue sooner. Null when nobody is waiting.
 */
export function waitingFor(exception, now = Date.now()) {
  if (!exception?.awaitingSince || exception.status === "resolved") return null;
  const since = new Date(exception.awaitingSince).getTime();
  if (!Number.isFinite(since)) return null;
  const minutes = Math.max(0, Math.floor((now - since) / 60000));
  const text = minutes < 1 ? "under a minute" : minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
  const overdueAfter = exception.severity === "critical" ? 60 : 240;
  const lateAfter = exception.severity === "critical" ? 15 : 60;
  return { text, minutes, tone: minutes >= overdueAfter ? "overdue" : minutes >= lateAfter ? "late" : "new" };
}

/**
 * The board, plus the alert kinds this person has muted on the Notifications
 * screen. The server leaves muted kinds out of the rows, so the page has to be
 * told what is missing — a board that quietly drops alerts is worse than one
 * that shows too many.
 */
export async function getExceptions(filters = {}) {
  const query = new URLSearchParams();
  if (filters.status && filters.status !== "all") query.set("status", filters.status);
  if (filters.severity && filters.severity !== "all") query.set("severity", filters.severity);
  if (filters.type) query.set("type", filters.type);

  const suffix = query.size ? `?${query.toString()}` : "";
  const response = await get(`/operations/exceptions${suffix}`);
  return {
    items: (response.data || []).map(mapException),
    muted: response.meta?.muted || [],
  };
}

export async function getAllExceptions(filters = {}) {
  const { items } = await getExceptions(filters);
  return items;
}

export async function createException(payload) {
  return post("/operations/exceptions", payload);
}

export async function acknowledgeException(id) {
  return post(`/operations/exceptions/${id}/acknowledge`);
}

export async function resolveException(id, resolutionNotes) {
  return post(`/operations/exceptions/${id}/resolve`, { resolutionNotes });
}

/* ------------------------------------------------------------------ */
/* What a driver reported                                              */
/* ------------------------------------------------------------------ */

/**
 * The report behind an exception a driver filed — a pause request with its
 * reason, description and photographs, or a concern from Help & Support. Null
 * for an exception nobody filed.
 */
export async function getDriverReport(exceptionId) {
  const response = await get(`/operations/exceptions/${exceptionId}/driver-report`);
  return response.data || null;
}

/** A photograph from the report. It sits behind a signed-in route, so it comes as a data URL. */
export function getReportPhoto(exceptionId, photoId) {
  return getDataUrl(`/operations/exceptions/${exceptionId}/driver-report/photos/${photoId}`);
}

/** Approve a pause request. `note` goes to the driver; `customerMessage` is what the customer is shown. */
export function approvePause(exceptionId, { note, customerMessage } = {}) {
  return post(`/operations/exceptions/${exceptionId}/pause/approve`, { note, customerMessage });
}

/** Decline a pause request. The driver is told why, so a note is required. */
export function declinePause(exceptionId, { note } = {}) {
  return post(`/operations/exceptions/${exceptionId}/pause/decline`, { note });
}

/** End an approved pause from the office: the delivery resumes. */
/** A delivery that was not made: ask the driver to try again. The trip stays on the road. */
export function reattemptDelivery(exceptionId, { note } = {}) {
  return post(`/operations/exceptions/${exceptionId}/delivery-report/reattempt`, { note });
}

/** A delivery that was not made: the load comes back, and the trip is marked returned. */
export function returnDelivery(exceptionId, { note } = {}) {
  return post(`/operations/exceptions/${exceptionId}/delivery-report/return`, { note });
}

export function resumePause(exceptionId, { note, customerMessage } = {}) {
  return post(`/operations/exceptions/${exceptionId}/pause/resume`, { note, customerMessage });
}

/** The conversation with the driver behind an exception. */
export async function getDriverThread(exceptionId) {
  const response = await get(`/operations/exceptions/${exceptionId}/driver-report/thread`);
  // Reading the thread marks the driver's messages read: the bell re-counts.
  if (typeof window !== "undefined") window.dispatchEvent(new Event("trackify:support-read"));
  return response.data || null;
}

export async function replyToDriver(exceptionId, body) {
  const response = await post(`/operations/exceptions/${exceptionId}/driver-report/reply`, { body });
  return response.data;
}

export function getExceptionStats(exceptions = []) {
  return {
    total: exceptions.length,
    open: exceptions.filter((item) => item.status === "open").length,
    acknowledged: exceptions.filter((item) => item.status === "acknowledged").length,
    resolved: exceptions.filter((item) => item.status === "resolved").length,
    critical: exceptions.filter((item) => item.severity === "critical").length,
    warning: exceptions.filter((item) => item.severity === "warning").length,
    info: exceptions.filter((item) => item.severity === "info").length,
  };
}

export { exceptionTypes };
