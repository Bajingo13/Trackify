import VehicleArt from "../components/fleet/VehicleArt"
import { photoFor } from "../components/fleet/vehiclePhotos"

export { photoFor }

/**
 * The vehicle on this trip, as a photograph where one exists.
 *
 * The type-to-photograph mapping lives in components/fleet/vehiclePhotos so
 * the driver app and the web system cannot end up disagreeing about what a
 * given body shape looks like. This file is only how the driver app presents
 * it: sized for a card, and animated while a run is actually moving.
 */
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
