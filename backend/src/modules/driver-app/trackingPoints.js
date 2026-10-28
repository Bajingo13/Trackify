import { checkClientRef } from "../chat/tripChat.service.js";

/**
 * One GPS reading from the Driver App, read and stored — the live ping and the
 * trail recovered after a dead zone both come through here.
 *
 * Time. A reading carries its age, not a clock time: how long ago the phone
 * captured it, measured on the phone's own clock at both ends, so a phone set
 * to the wrong time cannot move a point. The server stamps it
 * NOW() - INTERVAL age SECOND, in SQL, so the database's own clock and zone are
 * the only ones involved — as recorded_at always was.
 *
 * Duplicates. A reading has the phone's own name (client_ref). The unique key
 * (driver_id, client_ref) from migration 059 stores it once however often it
 * arrives: a retried batch, or a live ping and the recovered copy of it.
 */

/* The outbox replays a live fix for at most 15 minutes; more is not one of its own. */
export const LIVE_MAX_AGE_S = 30 * 60;
/* The phone keeps a recovered trail for 24 hours; a day's grace on top for a phone left off. */
export const TRAIL_MAX_AGE_S = 48 * 60 * 60;
export const TRAIL_BATCH_MAX = 200;
/* A recovered point is history: only a fix this fresh moves dispatch's live marker. */
export const PUBLISH_MAX_AGE_S = 120;
/* Worse than this is a guess about the town, not where the truck was. */
export const MAX_TRAIL_ACCURACY_M = 500;
/* Slack either side of the trip's departure and arrival, for clocks and GPS warm-up. */
export const WINDOW_EDGE_S = 5 * 60;

/** Whether a live ping this old should move dispatch's map, or is only history. */
export const movesLiveMap = (ageS) => ageS <= PUBLISH_MAX_AGE_S;

export const finiteOrNull = (value) => {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * The parts of a reading that do not depend on the trip. { point } or
 * { error } — the error worded for the live ping's existing 400s.
 */
export function readPoint(raw) {
  const lat = Number(raw?.lat);
  const lng = Number(raw?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { error: "lat and lng are required." };
  // A point off the globe is a broken reading, not a place: stored, it would
  // sit in the trip's history and jump the truck on dispatch's live map.
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return { error: "lat must be between -90 and 90, and lng between -180 and 180." };
  }
  // ageMs from this build; queuedForMs from builds that sent that instead
  const ageMs = finiteOrNull(raw.ageMs ?? raw.queuedForMs);
  return {
    point: {
      lat,
      lng,
      speedKph: finiteOrNull(raw.speedKph),
      heading: finiteOrNull(raw.heading),
      accuracyMeters: finiteOrNull(raw.accuracyMeters),
      clientRef: checkClientRef(raw.clientRef),
      ageS: ageMs == null ? null : Math.round(ageMs / 1000),
    },
  };
}

/**
 * Is a recovered point one this trip can have had? `trip.sinceDeparture` and
 * `trip.sinceArrival` are seconds before NOW(), from the database. null when
 * it is acceptable, otherwise the reason.
 */
export function trailRejection(point, trip) {
  if (!point.clientRef) return "missing clientRef";
  if (point.ageS == null || point.ageS < 0) return "missing or negative age";
  if (point.ageS > TRAIL_MAX_AGE_S) return "too old";
  if (point.accuracyMeters != null && point.accuracyMeters > MAX_TRAIL_ACCURACY_M) return "too inaccurate";
  if (trip.sinceDeparture != null && point.ageS > Number(trip.sinceDeparture) + WINDOW_EDGE_S) {
    return "before the trip started";
  }
  if (trip.sinceArrival != null && point.ageS < Number(trip.sinceArrival) - WINDOW_EDGE_S) {
    return "after the trip was delivered";
  }
  return null;
}

/**
 * Store one point. "accepted", or "duplicate" when this driver already sent
 * this reading. A database without migration 059 still takes a live ping, the
 * old way; a recovered one cannot be told from a duplicate there, so it throws
 * and the phone keeps it for later.
 */
export async function insertPoint(runner, { companyId, branchId, tripId, driverId, vehicleId, point, ageS, source }) {
  try {
    await runner.execute(
      `INSERT INTO trip_tracking_points
         (company_id, branch_id, trip_ticket_id, driver_id, vehicle_id,
          latitude, longitude, speed_kph, heading, accuracy_meters, gps_status,
          client_ref, recorded_at, received_at, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'online', ?, NOW() - INTERVAL ? SECOND, NOW(), ?)`,
      [
        companyId, branchId, tripId, driverId, vehicleId,
        point.lat, point.lng, point.speedKph, point.heading, point.accuracyMeters,
        point.clientRef, ageS, source,
      ]
    );
    return "accepted";
  } catch (e) {
    if (e?.code === "ER_DUP_ENTRY") return "duplicate";
    if (e?.code === "ER_BAD_FIELD_ERROR" && source === "live") {
      await runner.execute(
        `INSERT INTO trip_tracking_points
           (company_id, branch_id, trip_ticket_id, driver_id, vehicle_id,
            latitude, longitude, speed_kph, heading, accuracy_meters, gps_status, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'online', NOW() - INTERVAL ? SECOND)`,
        [
          companyId, branchId, tripId, driverId, vehicleId,
          point.lat, point.lng, point.speedKph, point.heading, point.accuracyMeters, ageS,
        ]
      );
      return "accepted";
    }
    throw e;
  }
}
