import { get, post } from "./apiClient";

/**
 * Place search, structured address lookup, reverse geocoding and routing.
 *
 * Every result carries a `precision` — house, street, barangay, city, province
 * or area — so a screen can say how exact a match is instead of dropping an
 * identical-looking pin for "123 Rizal Street, Barangay Poblacion" and for
 * "Davao City". That distinction is the difference between a driver arriving at
 * a door and arriving in a city.
 */

/**
 * Free-text search. `near` biases results to the area being worked in, which
 * is what stops a street name matching the same-named street elsewhere.
 * → [{ label, fullLabel, lat, lng, precision, address }]
 */
export async function searchPlaces(q, near = null) {
  if (!q || q.trim().length < 3) return [];
  const params = new URLSearchParams({ q: q.trim() });
  if (near?.lat != null && near?.lng != null) {
    params.set("lat", String(near.lat));
    params.set("lng", String(near.lng));
  }
  const res = await get(`/operations/geo/search?${params}`);
  return res?.data || [];
}

/**
 * The same search, but it gives up one part of the address at a time instead of
 * answering with nothing.
 *
 * Most Philippine addresses a dispatcher types are not in OpenStreetMap. A
 * house number, a subdivision, even one misspelled barangay is enough for a
 * strict search to return an empty list, which on screen is indistinguishable
 * from the system being broken. This returns the closest thing that does exist
 * and says what it actually matched, so the screen can tell the truth about it.
 *
 * → { results: [...], matchedQuery: string|null, degraded: boolean }
 */
export async function searchPlacesBest(q, near = null) {
  if (!q || q.trim().length < 3) return { results: [], matchedQuery: null, degraded: false };
  const params = new URLSearchParams({ q: q.trim() });
  if (near?.lat != null && near?.lng != null) {
    params.set("lat", String(near.lat));
    params.set("lng", String(near.lng));
  }
  try {
    const res = await get(`/operations/geo/search/best?${params}`);
    return {
      results: res?.data || [],
      matchedQuery: res?.matchedQuery || null,
      degraded: Boolean(res?.degraded),
    };
  } catch {
    return { results: [], matchedQuery: null, degraded: false };
  }
}

/**
 * Structured lookup — house number, street, barangay, city in their own fields.
 *
 * Better than running the same words together: each component is matched at the
 * right level rather than the geocoder guessing where the street ends and the
 * barangay begins.
 */
export async function searchAddress(parts = {}) {
  const params = new URLSearchParams();
  for (const key of ["houseNumber", "street", "barangay", "city", "province", "postcode"]) {
    if (parts[key]) params.set(key, String(parts[key]).trim());
  }
  if (parts.near?.lat != null && parts.near?.lng != null) {
    params.set("lat", String(parts.near.lat));
    params.set("lng", String(parts.near.lng));
  }
  if ([...params.keys()].filter((k) => k !== "lat" && k !== "lng").length === 0) return [];
  const res = await get(`/operations/geo/search/address?${params}`);
  return res?.data || [];
}

/**
 * What is at this point. Returns null when nothing is known there, which is a
 * real answer in rural Philippines rather than an error.
 */
export async function describePoint(lat, lng) {
  try {
    const res = await get(`/operations/geo/reverse?lat=${lat}&lng=${lng}`);
    return res?.data || null;
  } catch {
    return null;
  }
}

/** Driving route between two {lat,lng}, optionally through ordered waypoints. */
export async function getRoute(from, to, waypoints = []) {
  if (!from?.lat || !to?.lat) return null;
  try {
    const res = await post("/operations/geo/route", { from, to, waypoints });
    return res?.data || null;
  } catch {
    return null;
  }
}

/** How exact a match is, for a badge beside a search result. */
export const PRECISION_LABEL = {
  house: "Exact address",
  street: "Street",
  barangay: "Barangay",
  city: "City / municipality",
  province: "Province",
  area: "Approximate",
};

/**
 * Whether a match is precise enough to send a truck to.
 *
 * A city-level pin is the middle of a city, not a delivery point. Treating it
 * as good enough is how a trip ends up routed to a plaza.
 */
export const isDeliverable = (precision) =>
  precision === "house" || precision === "street" || precision === "barangay";
