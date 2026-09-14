import { useEffect, useState } from "react"
import VehicleArt from "../components/fleet/VehicleArt"
import { photoFor } from "../components/fleet/vehiclePhotos"
import { driverTypePhoto } from "./driverApi"

export { photoFor }

/**
 * Company photographs, fetched once per type and kept for the session.
 *
 * A driver sees one or two vehicle types in a shift, so this stays tiny. It is
 * module-level rather than React state because the trip list and the trip
 * screen both draw the same vehicle, and fetching it twice would be one
 * needless round trip on a phone that may be on one bar.
 *
 * A type that resolves to null is still recorded, so a company with no photo
 * for it is asked once and never again.
 */
const cache = new Map()
const inflight = new Map()

function fetchOnce(vehicleType) {
  if (!inflight.has(vehicleType)) {
    inflight.set(
      vehicleType,
      driverTypePhoto(vehicleType)
        .catch(() => null)
        .then((url) => {
          cache.set(vehicleType, url)
          inflight.delete(vehicleType)
          return url
        })
    )
  }
  return inflight.get(vehicleType)
}

function useCompanyPhoto(vehicleType) {
  const [src, setSrc] = useState(() => cache.get(vehicleType) ?? null)

  useEffect(() => {
    if (!vehicleType) return undefined
    if (cache.has(vehicleType)) {
      setSrc(cache.get(vehicleType))
      return undefined
    }
    let dead = false
    fetchOnce(vehicleType).then((url) => {
      if (!dead) setSrc(url)
    })
    return () => {
      dead = true
    }
  }, [vehicleType])

  return src
}

/**
 * The vehicle on this trip, as a photograph where one exists.
 *
 * Three sources, in order: the photograph this company uploaded for the type,
 * the photograph bundled with the app, then the drawn silhouette. The company
 * one comes first so the truck a driver is looking for on the phone is the
 * same truck the office sees on the board.
 *
 * The type-to-photograph mapping for the bundled set lives in
 * components/fleet/vehiclePhotos, shared with the web system so the two cannot
 * end up disagreeing about what a given body shape looks like.
 */
export default function VehiclePhoto({ vehicleType, status, className }) {
  const own = useCompanyPhoto(vehicleType)
  const src = own || photoFor(vehicleType)

  if (!src) {
    return (
      <VehicleArt
        type={vehicleType}
        height={72}
        animated={status === "in_transit"}
        className={className}
      />
    )
  }

  return (
    <img
      className={className}
      src={src}
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
    />
  )
}
