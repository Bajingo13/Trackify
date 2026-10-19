import { useCallback, useEffect, useState } from "react";
import { driverTripTrail } from "./driverApi";

/** A run is done once it is delivered; from then on its map looks back at the road driven. */
export const DONE_STATUSES = ["delivered", "returned", "operationally_closed"];
export const isDone = (status) => DONE_STATUSES.includes(status);

/**
 * The line to draw for the trail: the road-snapped one when the server had it,
 * otherwise the raw fixes joined up. Null when there is nothing to draw.
 */
export function drivenLine(trail) {
  if (!trail) return null;
  if (trail.snapped?.coordinates?.length > 1) return trail.snapped;
  const coords = (trail.points || [])
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .map((p) => [p.lng, p.lat]);
  return coords.length > 1 ? { type: "LineString", coordinates: coords } : null;
}

/**
 * The driver's trail for a finished run, fetched the first time the map is
 * opened and kept for the visit. `state`: idle, loading, ready or error.
 */
export function useDrivenTrail(tripId, active) {
  const [got, setGot] = useState({ state: "idle", trail: null });

  const load = useCallback(() => {
    setGot({ state: "loading", trail: null });
    return driverTripTrail(tripId)
      .then((trail) => setGot({ state: "ready", trail }))
      .catch(() => setGot({ state: "error", trail: null }));
  }, [tripId]);

  useEffect(() => {
    if (active && got.state === "idle") load();
  }, [active, got.state, load]);

  return { ...got, retry: load };
}

/** "10:02 AM" for a fix's timestamp; the date too when the run ran past a day. */
export function fmtClock(iso, withDate = false) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return withDate ? `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}` : time;
}

/** Whether two timestamps fall on different calendar days, on this phone's clock. */
export function spansDays(a, b) {
  const x = new Date(a), y = new Date(b);
  return x.toDateString() !== y.toDateString();
}
