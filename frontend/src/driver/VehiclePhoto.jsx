import { variantFor } from "../components/fleet/VehicleArt"
import VehicleArt from "../components/fleet/VehicleArt"
import tractorJpg from "../assets/veh-tractor.jpg"
import boxJpg from "../assets/veh-box.jpg"
import flatbedJpg from "../assets/veh-flatbed.jpg"
import tankerJpg from "../assets/veh-tanker.jpg"

/**
 * The vehicle on this trip, as a photograph where one exists.
 *
 * VehicleArt already turns a vehicle_type into one of ten silhouettes; this
 * reuses that same mapping so the two never disagree about what a "Wing Van"
 * is, and swaps in a photograph for the body shapes we have shots of.
 *
 * Three photographs cover most of a Philippine fleet — an articulated
 * curtainsider, a light box truck, a dropside — so they are grouped by body
 * shape rather than stretched one-per-type. Only a motorcycle has no
 * photograph, and this fleet does not run them; it falls back to the drawn
 * silhouette rather than being shown as the wrong vehicle, which would be
 * worse than a diagram — a driver checking they are at the right truck is the
 * whole reason this is on screen.
 */
const PHOTOS = {
  tractor: tractorJpg,
  container: tractorJpg,
  wing: tractorJpg,
  box: boxJpg,
  reefer: boxJpg,
  van: boxJpg,
  flatbed: flatbedJpg,
  pickup: flatbedJpg,
  tanker: tankerJpg,
}

export function photoFor(vehicleType) {
  return PHOTOS[variantFor(vehicleType)] || null
}

export default function VehiclePhoto({ vehicleType, status, className }) {
  const src = photoFor(vehicleType)

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
