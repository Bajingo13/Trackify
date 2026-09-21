import { variantFor } from "./VehicleArt"
import tractorJpg from "../../assets/veh-tractor.jpg"
import boxJpg from "../../assets/veh-box.jpg"
import flatbedJpg from "../../assets/veh-flatbed.jpg"
import tankerJpg from "../../assets/veh-tanker.jpg"

/**
 * Which photograph stands for which kind of vehicle.
 *
 * One map, used by both the web fleet component and the driver app's. They
 * each present a vehicle differently — the web one can show a load ratio, the
 * driver one animates while a run is in transit — but what a "Wing Van" *is*
 * must not be a thing the two can disagree about. Held here so adding a
 * photograph, or correcting a mapping, happens once.
 *
 * Keyed on VehicleArt's own `variantFor`, so the photograph and the drawn
 * silhouette are always resolved from the same answer.
 *
 * Four photographs cover a Philippine fleet by body shape rather than one per
 * type: an articulated curtainsider, a light box truck, a dropside, a tanker.
 * A type with no photograph falls back to the drawing rather than being shown
 * as the wrong vehicle — a driver checking they are at the right truck is the
 * whole reason this is on screen, and a confident wrong answer is worse there
 * than an obvious diagram.
 */
const PHOTOS = {
  tractor: tractorJpg,
  container: tractorJpg,
  /*
   * A wing van is deliberately absent, not forgotten.
   *
   * It used to point at the curtainsider, with a note admitting that was the
   * closest of the four supplied shots rather than a correct one. A wing van is
   * a rigid truck with side-opening panels; the curtainsider is an articulated
   * unit with a tractor in front of it. Showing one as the other is exactly the
   * "confident wrong answer" the rule above exists to prevent, and a driver
   * checking they are at the right truck is who pays for it.
   *
   * With no entry here it falls back to the drawn silhouette, which has the
   * right shape — a rigid body on one chassis. That is less impressive and more
   * honest. Add a real wing van photograph and it takes over automatically.
   */
  box: boxJpg,
  reefer: boxJpg,
  van: boxJpg,
  flatbed: flatbedJpg,
  pickup: flatbedJpg,
  tanker: tankerJpg,
}

/** The photograph for this vehicle type, or null when there is none. */
export function photoFor(vehicleType) {
  return PHOTOS[variantFor(vehicleType)] || null
}
