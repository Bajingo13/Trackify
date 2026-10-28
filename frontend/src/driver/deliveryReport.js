/**
 * Delivery exceptions on the phone: the reasons a driver can give, and the
 * "not delivered" report this phone filed for a trip, kept until the server's
 * own answer arrives with the trip.
 *
 * A report made at a closed gate with no signal waits in the outbox. Meanwhile
 * the trip screen has to say it was reported, so the driver keeps the load on
 * the truck and does not report it twice. The server's view, once the trip has
 * loaded with a newer report, always wins.
 *
 * The reasons and their rules mirror deliveryReports.service.js on the server,
 * which checks them again.
 */

export const OUTCOMES = {
  delivered_with_issue: "delivered_with_issue",
  not_delivered: "not_delivered",
};

export const REPORT_REASONS = [
  { value: "short", outcome: "delivered_with_issue", label: "Short delivery", hint: "Fewer delivered than expected", photo: true },
  { value: "damaged", outcome: "delivered_with_issue", label: "Damaged goods", hint: "Broken, crushed, wet or opened", photo: true },
  { value: "wrong_item", outcome: "delivered_with_issue", label: "Wrong item", hint: "Not what was ordered", photo: false },
  { value: "refused", outcome: "not_delivered", label: "Refused by the receiver", hint: "They would not take the load", photo: false },
  { value: "absent", outcome: "not_delivered", label: "Receiver absent or closed", hint: "Nobody there, or the gate is shut", photo: false },
  { value: "wrong_address", outcome: "not_delivered", label: "Wrong address", hint: "The place does not match the delivery", photo: false },
  { value: "other", outcome: "not_delivered", label: "Other reason", hint: "Say what happened", photo: false },
];

export const reasonsFor = (outcome) => REPORT_REASONS.filter((r) => r.outcome === outcome);
export const reasonLabel = (value) => REPORT_REASONS.find((r) => r.value === value)?.label || "Other reason";

const keyFor = (driverId, tripId) => `trackify-driver-delivery-report:${driverId}:${tripId}`;

/** A "not delivered" report this phone filed (it may still be in the outbox). */
export function rememberNotDelivered(driverId, tripId, { reason }) {
  if (!driverId || !tripId) return;
  try {
    localStorage.setItem(keyFor(driverId, tripId), JSON.stringify({ reason, at: Date.now() }));
  } catch { /* blocked: the server's answer still comes with the trip */ }
}

export function localNotDelivered(driverId, tripId) {
  if (!driverId || !tripId) return null;
  try {
    const v = JSON.parse(localStorage.getItem(keyFor(driverId, tripId)) || "null");
    return v && typeof v.reason === "string" && Number.isFinite(v.at) ? v : null;
  } catch {
    return null;
  }
}

export function forgetNotDelivered(driverId, tripId) {
  try { localStorage.removeItem(keyFor(driverId, tripId)); } catch { /* nothing to forget */ }
}

/**
 * Where a "not delivered" report on this trip stands, for the trip screen:
 *   null          nothing reported, or no longer relevant
 *   { state: "waiting", reason }    reported; the office has not decided
 *   { state: "reattempt", reason }  the office asked for another try
 *
 * The server's report wins unless this phone filed a newer one it has not
 * seen yet (still in the outbox).
 */
export function notDeliveredState(trip, local) {
  if (trip?.status !== "in_transit") return null;
  const server = trip.deliveryReport?.outcome === OUTCOMES.not_delivered ? trip.deliveryReport : null;
  const serverAt = server?.submittedAt ? new Date(server.submittedAt).getTime() : 0;
  if (local && (!server || local.at > serverAt + 60_000)) return { state: "waiting", reason: local.reason };
  if (server?.status === "open") return { state: "waiting", reason: server.reason };
  if (server?.status === "reattempt") return { state: "reattempt", reason: server.reason };
  return null;
}
