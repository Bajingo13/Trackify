import { get, getDataUrl, post } from "../apiClient";

/**
 * Pre-trip vehicle inspections, for the Fleet team (backend fleet/inspection.*).
 *
 * A driver files one before each trip when the company requires it. Brakes,
 * tyres and lights are critical: a problem with any of them holds the trip
 * until Fleet approves departure with a reason. Anything else is a warning to
 * review; the trip may start.
 */

/** status: "pending" (waiting for Fleet), "failed" (any problem) or "all". */
export async function listInspections(status = "pending") {
  const res = await get(`/fleet/inspections?status=${encodeURIComponent(status)}`);
  return res.data || [];
}

export async function getInspection(id) {
  const res = await get(`/fleet/inspections/${id}`);
  return res.data || null;
}

/** A photo of a defect. It sits behind a signed-in route, so it comes as a data URL. */
export function getInspectionPhoto(id, photoId) {
  return getDataUrl(`/fleet/inspections/${id}/photos/${photoId}`);
}

/** Let a trip go after a failed critical item. The reason is kept and audited. */
export function approveDeparture(id, reason) {
  return post(`/fleet/inspections/${id}/approve-departure`, { reason });
}

/** Mark a non-critical issue as looked at. */
export function reviewInspection(id, note) {
  return post(`/fleet/inspections/${id}/review`, { note });
}

/** Where an inspection stands, in Fleet's words, with a tone for the badge. */
export function inspectionStatus(row) {
  if (!row) return { label: "", tone: "muted" };
  if (row.result === "fail_critical") {
    return row.approvedAt
      ? { label: "Departure approved", tone: "ok" }
      : { label: "Trip on hold", tone: "danger" };
  }
  if (row.result === "fail_noncritical") {
    return row.reviewStatus === "pending" ? { label: "To review", tone: "warn" } : { label: "Reviewed", tone: "ok" };
  }
  return { label: "Passed", tone: "ok" };
}
