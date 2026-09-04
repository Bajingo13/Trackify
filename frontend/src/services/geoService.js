import { get, post } from "./apiClient";

/** Free-text place search (PH-biased). → [{ label, lat, lng }] */
export async function searchPlaces(q) {
  if (!q || q.trim().length < 3) return [];
  const res = await get(`/operations/geo/search?q=${encodeURIComponent(q.trim())}`);
  return res?.data || [];
}

/** Driving route between two {lat,lng}. → { distanceKm, durationMin, geometry } | null */
export async function getRoute(from, to) {
  if (!from?.lat || !to?.lat) return null;
  try {
    const res = await post("/operations/geo/route", { from, to });
    return res?.data || null;
  } catch {
    return null;
  }
}
