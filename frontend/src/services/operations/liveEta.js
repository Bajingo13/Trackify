export const GPS_FRESH_MS = 15 * 60 * 1000;
const FUTURE_CLOCK_ALLOWANCE_MS = 60 * 1000;

const finite = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const time = (value) => {
  const milliseconds = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(milliseconds) ? milliseconds : null;
};

function lineCoordinates(geometry) {
  if (!geometry) return null;
  let parsed = geometry;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); } catch { return null; }
  }
  if (parsed?.type !== "LineString" || !Array.isArray(parsed.coordinates)) return null;
  const coordinates = parsed.coordinates
    .map((point) => [finite(point?.[0]), finite(point?.[1])])
    .filter(([lng, lat]) => lng != null && lat != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180);
  return coordinates.length >= 2 ? coordinates : null;
}

/**
 * Match one GPS point to the nearest segment of the cached route.
 * This is local geometry only: no map, routing, traffic or paid API request.
 */
export function progressOnRoute(geometry, lat, lng) {
  const coordinates = lineCoordinates(geometry);
  const pointLat = finite(lat);
  const pointLng = finite(lng);
  if (!coordinates || pointLat == null || pointLng == null) return null;

  const referenceLat = coordinates.reduce((sum, point) => sum + point[1], 0) / coordinates.length;
  const xScale = 111.32 * Math.cos(referenceLat * Math.PI / 180);
  const yScale = 110.574;
  const project = ([x, y]) => [x * xScale, y * yScale];
  const route = coordinates.map(project);
  const point = project([pointLng, pointLat]);
  const lengths = [];
  let totalKm = 0;
  for (let index = 1; index < route.length; index += 1) {
    const dx = route[index][0] - route[index - 1][0];
    const dy = route[index][1] - route[index - 1][1];
    const length = Math.hypot(dx, dy);
    lengths.push(length);
    totalKm += length;
  }
  if (totalKm < 0.05) return null;

  let bestDistanceKm = Infinity;
  let bestAlongKm = 0;
  let travelledKm = 0;
  for (let index = 1; index < route.length; index += 1) {
    const start = route[index - 1];
    const end = route[index];
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared > 0
      ? Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared))
      : 0;
    const nearest = [start[0] + t * dx, start[1] + t * dy];
    const distanceKm = Math.hypot(point[0] - nearest[0], point[1] - nearest[1]);
    if (distanceKm < bestDistanceKm) {
      bestDistanceKm = distanceKm;
      bestAlongKm = travelledKm + t * lengths[index - 1];
    }
    travelledKm += lengths[index - 1];
  }

  // A point far from the planned road is not route progress. The modest
  // distance allowance handles ordinary phone accuracy and nearby side roads.
  const offRouteLimitKm = Math.max(1.5, Math.min(5, totalKm * 0.05));
  if (bestDistanceKm > offRouteLimitKm) return null;
  return {
    progress: Math.max(0, Math.min(1, bestAlongKm / totalKm)),
    geometryDistanceKm: totalKm,
    offRouteKm: bestDistanceKm,
  };
}

function scheduledEstimate(trip) {
  const routeMinutes = finite(trip?.routeMin);
  const actualDeparture = time(trip?.actualDeparture);
  const scheduledDeparture = time(trip?.scheduledDeparture);
  const scheduledArrival = time(trip?.scheduledArrival);
  if (routeMinutes != null && routeMinutes > 0 && actualDeparture != null) {
    return actualDeparture + routeMinutes * 60_000;
  }
  if (scheduledArrival != null) return scheduledArrival;
  if (routeMinutes != null && routeMinutes > 0 && scheduledDeparture != null) {
    return scheduledDeparture + routeMinutes * 60_000;
  }
  return null;
}

/**
 * Honest operational ETA derived only from Trackify's cached route and GPS.
 * It never claims traffic awareness, and stale/missing GPS always falls back
 * to the schedule instead of pretending an old position is still moving.
 */
export function estimateLiveEta({ trip, tracking, route, now = Date.now() }) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const status = String(trip?.status || "").toLowerCase();
  const actualArrival = time(trip?.actualArrival);
  if (["delivered", "closed"].includes(status) && actualArrival != null) {
    return { kind: "arrived", etaAt: actualArrival, label: "Arrived", updatedAt: actualArrival, trafficAware: false };
  }

  const fallbackAt = scheduledEstimate(trip);
  const lastGpsAt = time(tracking?.lastGpsUpdate);
  const gpsAgeMs = lastGpsAt == null ? null : nowMs - lastGpsAt;
  const fresh = gpsAgeMs != null && gpsAgeMs >= -FUTURE_CLOCK_ALLOWANCE_MS && gpsAgeMs <= GPS_FRESH_MS;
  const fallback = (kind, notice) => ({
    kind,
    etaAt: fallbackAt,
    label: "Scheduled estimate",
    updatedAt: lastGpsAt,
    gpsAgeMs,
    notice,
    trafficAware: false,
    progress: null,
    distanceRemainingKm: null,
  });

  if (trip?.pause) return fallback("paused", "Delivery is paused. ETA may change after the trip resumes.");
  if (!tracking?.hasGps || lastGpsAt == null) return fallback("no-gps", "No live location is available.");
  if (!fresh || tracking?.gpsStatus === "offline") return fallback("stale", "GPS signal is delayed; showing the scheduled estimate.");
  if (status !== "in_transit") return fallback("scheduled", "The trip has not started moving yet.");

  const geometry = route?.geometry || trip?.routeGeom;
  const matched = progressOnRoute(geometry, tracking?.lat, tracking?.lng);
  const routeMinutes = finite(route?.durationMin) ?? finite(trip?.routeMin);
  if (!matched || routeMinutes == null || routeMinutes <= 0) {
    return fallback("unmatched", "The latest position cannot be matched reliably to the planned route.");
  }

  const progress = matched.progress;
  const plannedRemaining = routeMinutes * (1 - progress);
  let remainingMinutes = plannedRemaining;
  const departedAt = time(trip?.actualDeparture);
  if (departedAt != null && departedAt <= nowMs && progress >= 0.1 && progress < 0.99) {
    const elapsedMinutes = (nowMs - departedAt) / 60_000;
    const paceRemaining = elapsedMinutes * (1 - progress) / progress;
    // Blend actual progress with the route plan, with a hard ceiling so one
    // noisy fix cannot turn a two-hour trip into a day-long ETA.
    remainingMinutes = plannedRemaining * 0.6 + paceRemaining * 0.4;
  }
  remainingMinutes = Math.max(1, Math.min(routeMinutes * 3, remainingMinutes));
  const plannedDistance = finite(route?.distanceKm) ?? finite(trip?.routeKm) ?? matched.geometryDistanceKm;

  return {
    kind: "live",
    etaAt: nowMs + Math.round(remainingMinutes) * 60_000,
    label: "Live operational estimate",
    updatedAt: lastGpsAt,
    gpsAgeMs,
    notice: "Based on route progress. Live traffic is not included.",
    trafficAware: false,
    progress,
    distanceRemainingKm: plannedDistance != null ? Math.max(0, plannedDistance * (1 - progress)) : null,
  };
}

export function formatEtaClock(value) {
  const milliseconds = time(value);
  if (milliseconds == null) return "—";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(milliseconds));
}

export function formatGpsAge(ageMs) {
  if (!Number.isFinite(ageMs) || ageMs < 0) return "just now";
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1 minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }
  return `${hours} hour${hours === 1 ? "" : "s"} ago`;
}
