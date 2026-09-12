import { variantFor } from "../components/fleet/VehicleArt"
import VehicleArt from "../components/fleet/VehicleArt"
import tractorJpg from "../assets/veh-tractor.jpg"
import boxJpg from "../assets/veh-box.jpg"
import flatbedJpg from "../assets/veh-flatbed.jpg"

/**
 * The vehicle on this trip, as a photograph where one exists.
 *
 * VehicleArt already turns a vehicle_type into one of ten silhouettes; this
 * reuses that same mapping so the two never disagree about what a "Wing Van"
 * is, and swaps in a photograph for the body shapes we have shots of.
 *
 * Three photographs cover most of a Philippine fleet — an articulated
 * curtainsider, a light box truck, a dropside — so they are grouped by body
 * shape rather than stretched one-per-type. A tanker or a motorcycle has no
 * photograph and falls back to the drawn silhouette rather than being shown as
 * the wrong truck, which would be worse than a diagram.
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
