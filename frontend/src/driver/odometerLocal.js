/**
 * The odometer readings this phone entered for a trip, kept until the trip
 * comes back from the server with them.
 *
 * Out of signal a reading waits in the outbox, ahead of the Start or the
 * delivery that follows it, and the server checks for it again then. The
 * screen still has to know it was entered, or it would ask for it twice.
 * The server's copy, once the trip has loaded with it, always wins.
 */

const keyFor = (driverId, tripId) => `trackify-driver-odometer:${driverId}:${tripId}`;

export function localOdometer(driverId, tripId) {
  if (!driverId || !tripId) return null;
  try {
    const v = JSON.parse(localStorage.getItem(keyFor(driverId, tripId)) || "null");
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

export function rememberOdometer(driverId, tripId, kind, valueKm) {
  if (!driverId || !tripId || (kind !== "start" && kind !== "end")) return;
  try {
    const now = localOdometer(driverId, tripId) || {};
    localStorage.setItem(keyFor(driverId, tripId), JSON.stringify({ ...now, [kind]: valueKm }));
  } catch { /* blocked: the server's copy still comes with the trip */ }
}

export function forgetOdometer(driverId, tripId) {
  try { localStorage.removeItem(keyFor(driverId, tripId)); } catch { /* nothing to forget */ }
}

/**
 * Must the driver enter this reading before going on? Only when the company
 * requires readings (trip.odometer.required), at the step it belongs to, and
 * when neither the server nor this phone has it yet.
 */
export function needsOdometerReading(trip, local, kind) {
  const odo = trip?.odometer;
  if (!odo?.required) return false;
  if (kind === "start") return trip.status === "released" && !odo.start && local?.start == null;
  if (kind === "end") return trip.status === "in_transit" && !odo.end && local?.end == null;
  return false;
}

/** The start figure to check an end reading against: the server's, or this phone's. */
export function startKmOf(trip, local) {
  const server = trip?.odometer?.start?.effectiveKm;
  return server != null ? Number(server) : local?.start != null ? Number(local.start) : null;
}
