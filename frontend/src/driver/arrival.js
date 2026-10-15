/**
 * Has the truck reached the drop-off pin?
 *
 * There is no per-customer radius in the system, so one distance is used for
 * every delivery. 150 m is wide enough for a GPS fix that wanders in a loading
 * yard or under a canopy, and narrow enough not to fire on the road past the
 * gate. It lives here, in one place, so it can be tuned (or made a company
 * setting) without hunting for it.
 */
export const ARRIVAL_RADIUS_M = 150

const EARTH_M = 6371008.8

/** Great-circle distance in metres between two { lat, lng } points. */
export function distanceMeters(a, b) {
  const rad = (d) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * True when the position is inside the radius of the trip's destination pin.
 * A trip saved without coordinates for its destination can never "arrive" —
 * there is no pin to be near — and the driver confirms delivery by hand.
 */
export function hasArrived(pos, trip, radius = ARRIVAL_RADIUS_M) {
  if (!pos || !trip) return false
  const lat = Number(trip.destLat)
  const lng = Number(trip.destLng)
  if (trip.destLat == null || trip.destLng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return false
  if (!Number.isFinite(pos.lat) || !Number.isFinite(pos.lng)) return false
  return distanceMeters(pos, { lat, lng }) <= radius
}
