/**
 * The pre-trip inspection this phone filed for a trip, kept until the server's
 * own answer arrives with the trip.
 *
 * An inspection done at a yard with no signal waits in the outbox, and so does
 * the Start after it — the outbox sends them in that order, and the server
 * checks the inspection again before it lets the trip start. Meanwhile the
 * screen has to know what the driver just answered: a pass lets them start, a
 * failed brake check must not. That is what this remembers. The server's view,
 * once the trip has loaded with it, always wins (DriverTripScreen.jsx).
 *
 * Per driver and per trip. Storage that is blocked leaves only the server's view.
 */

const keyFor = (driverId, tripId) => `trackify-driver-inspection:${driverId}:${tripId}`;

/** pass / fail_noncritical / fail_critical, worked out the way the server does. */
export function resultOfAnswers(answers, checklist) {
  const critical = new Set((checklist || []).filter((c) => c.critical).map((c) => c.key));
  const problems = Object.entries(answers || {}).filter(([, a]) => a?.response === "problem").map(([k]) => k);
  if (problems.some((k) => critical.has(k))) return "fail_critical";
  return problems.length ? "fail_noncritical" : "pass";
}

export function rememberInspection(driverId, tripId, { result, clientRef }) {
  if (!driverId || !tripId) return;
  try {
    localStorage.setItem(keyFor(driverId, tripId), JSON.stringify({ result, clientRef, at: Date.now() }));
  } catch { /* blocked: the server's answer still comes with the trip */ }
}

export function localInspection(driverId, tripId) {
  if (!driverId || !tripId) return null;
  try {
    const v = JSON.parse(localStorage.getItem(keyFor(driverId, tripId)) || "null");
    return v && typeof v.result === "string" ? v : null;
  } catch {
    return null;
  }
}

export function forgetInspection(driverId, tripId) {
  try { localStorage.removeItem(keyFor(driverId, tripId)); } catch { /* nothing to forget */ }
}

/**
 * Where a released trip's inspection stands for the Start button:
 *   null      the company does not require one (Start as always)
 *   "needed"  not done yet
 *   "passed" / "flagged" (a non-critical problem) / "approved" (Fleet let it go)
 *   "blocked" a critical item failed and Fleet has not approved departure
 */
export function inspectionGate(trip, local) {
  const insp = trip?.inspection;
  if (trip?.status !== "released" || !insp?.required) return null;
  if (insp.blocked) return "blocked";
  if (insp.satisfied) return insp.approved ? "approved" : insp.result === "fail_noncritical" ? "flagged" : "passed";
  if (local?.result === "fail_critical") return "blocked";
  if (local?.result === "fail_noncritical") return "flagged";
  if (local?.result === "pass") return "passed";
  return "needed";
}

export const canStartWith = (gate) => gate == null || gate === "passed" || gate === "flagged" || gate === "approved";
