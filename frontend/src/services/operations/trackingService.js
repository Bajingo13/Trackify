import { get } from "../apiClient";

const numOrNull = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

/** route_geometry comes back as a parsed object from mysql2, but tolerate a string too. */
function asGeoJson(v) {
  if (!v) return null;
  if (typeof v === "string") {
    try { return JSON.parse(v); } catch { return null; }
  }
  return typeof v === "object" && Array.isArray(v.coordinates) ? v : null;
}

/**
 * Active-trip rows come back snake_cased and carry only the latest GPS ping.
 * Route progress / distance-remaining / live ETA need route geometry from a map
 * provider, which isn't wired yet — those are surfaced as null so the UI can
 * show "—" instead of a fabricated number.
 */
function mapActiveTrip(r = {}) {
  const hasGps = r.latitude != null && r.longitude != null;
  const oc = numOrNull(r.origin_lat) != null && numOrNull(r.origin_lng) != null
    ? { lat: Number(r.origin_lat), lng: Number(r.origin_lng) } : null;
  const dc = numOrNull(r.destination_lat) != null && numOrNull(r.destination_lng) != null
    ? { lat: Number(r.destination_lat), lng: Number(r.destination_lng) } : null;
  return {
    id: r.trip_ticket_id ?? r.id,
    ticketNo: r.ticket_no ?? "—",
    customer: r.customer_name ?? r.customer ?? "—",
    origin: r.origin ?? "—",
    destination: r.destination ?? "—",
    originCoord: oc,
    destCoord: dc,
    routeKm: numOrNull(r.route_distance_km),
    routeMin: numOrNull(r.route_duration_min),
    routeGeom: asGeoJson(r.route_geometry),
    status: r.status ?? "in_transit",
    driver: r.driver_name?.trim() || null,
    // already present in the response; the mapper simply had not exposed it
    driverId: r.driver_id ?? null,
    vehicleId: r.vehicle_id ?? null,
    vehicle: r.plate_no || null,
    vehicleType: r.vehicle_type || null,
    vehicleCapacityKg: numOrNull(r.vehicle_capacity),
    cargoWeightKg: numOrNull(r.cargo_weight),
    tracking: {
      hasGps,
      lat: numOrNull(r.latitude),
      lng: numOrNull(r.longitude),
      currentLocation: hasGps
        ? `${Number(r.latitude).toFixed(4)}, ${Number(r.longitude).toFixed(4)}`
        : "GPS not reporting",
      speed: numOrNull(r.speed_kph),
      heading: numOrNull(r.heading),
      accuracy: numOrNull(r.accuracy_meters),
      gpsStatus: r.gps_status || (hasGps ? "online" : "offline"),
      lastGpsUpdate: r.last_update || null,
      plannedArrival: r.scheduled_arrival || null,
      routeProgress: null,
      distanceRemaining: null,
    },
  };
}

/** Cached planned route for one trip → { distanceKm, durationMin, geometry }. */
export async function getTripRoute(tripId) {
  try {
    const res = await get(`/operations/trips/${tripId}/route`);
    const d = res?.data || {};
    return { ...d, geometry: asGeoJson(d.geometry) };
  } catch {
    return { geometry: null };
  }
}

export async function getActiveTripsWithTracking() {
  const res = await get("/operations/tracking/active-trips");
  return (res?.data || []).map(mapActiveTrip);
}

export async function getTrackingHistory(tripId) {
  const res = await get(`/operations/tracking/trips/${tripId}/history`);
  const points = (res?.data || []).map((p) => ({
    id: p.tracking_id,
    lat: numOrNull(p.latitude),
    lng: numOrNull(p.longitude),
    speed: numOrNull(p.speed_kph),
    heading: numOrNull(p.heading),
    gpsStatus: p.gps_status,
    recordedAt: p.recorded_at,
  }));
  return { points, snapped: asGeoJson(res?.snappedTrail) };
}
