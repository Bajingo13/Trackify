/**
 * Has the truck reached the drop-off pin?
 *
 * 150 m remains the compatibility-safe default. Current trips carry the
 * company's configured radius; saved trips from an older server do not, so
 * they continue to behave exactly as they did before this setting existed.
 */
export const ARRIVAL_RADIUS_M = 150
export const MIN_ARRIVAL_RADIUS_M = 50
export const MAX_ARRIVAL_RADIUS_M = 1000

export function arrivalRadius(value) {
  const metres = Number(value)
  return Number.isInteger(metres) && metres >= MIN_ARRIVAL_RADIUS_M && metres <= MAX_ARRIVAL_RADIUS_M
    ? metres
    : ARRIVAL_RADIUS_M
}

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
export function hasArrived(pos, trip, radius = trip?.arrivalRadiusM) {
  if (!pos || !trip) return false
  const lat = Number(trip.destLat)
  const lng = Number(trip.destLng)
  if (trip.destLat == null || trip.destLng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return false
  if (!Number.isFinite(pos.lat) || !Number.isFinite(pos.lng)) return false
  return distanceMeters(pos, { lat, lng }) <= arrivalRadius(radius)
}
