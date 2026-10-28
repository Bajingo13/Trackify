import { get, getDataUrl, post } from "../apiClient";

/**
 * Odometer readings on a trip (backend fleet/odometer.*): the start and end the
 * driver entered, the distance between them, and the Fleet team's corrections.
 */

/** { start, end, actualKm } — each reading { id, valueKm, correctedValueKm, effectiveKm, capturedAt, hasPhoto, correctedAt, correctionReason } or null. */
export async function getTripOdometer(tripId) {
  const res = await get(`/fleet/trips/${tripId}/odometer`);
  return res.data || { start: null, end: null, actualKm: null };
}

/** The dashboard photo behind a reading. It sits behind a signed-in route, so it comes as a data URL. */
export function getOdometerPhoto(readingId) {
  return getDataUrl(`/fleet/odometer-readings/${readingId}/photo`);
}

/** Correct a wrong reading. The driver's figure is kept; the reason is audited. */
export function correctOdometerReading(readingId, valueKm, reason) {
  return post(`/fleet/odometer-readings/${readingId}/correct`, { valueKm, reason });
}
