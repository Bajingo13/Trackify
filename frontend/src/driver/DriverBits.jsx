import VehicleArt from "../components/fleet/VehicleArt"

/**
 * The pieces the driver screens are built from.
 *
 * Everything here reads a trip as the driver experiences it — where the run has
 * got to, what is carrying it — rather than as the fields the API happens to
 * return.
 */

/* The four states a driver's run passes through. Anything the API reports that
 * is not one of these (cancelled, rejected) has no place on a progress rail,
 * and is handled by the caller instead of being forced onto it. */
export const LEG_ORDER = ["assigned", "released", "in_transit", "delivered"]

const LEGS = [
  { key: "assigned", caption: "Assigned", icon: IconClipboard },
  { key: "released", caption: "Loaded", icon: IconBox },
  { key: "in_transit", caption: "On the road", icon: IconTruck },
  { key: "delivered", caption: "Delivered", icon: IconCheck },
]

/** Where this run has got to, drawn across the card. */
export function TripTrack({ status }) {
  // "accepted" is a driver-side acknowledgement of an assignment, not a leg of
  // its own — it sits at the same point on the road.
  const normalised = status === "accepted" ? "assigned" : status
  const at = LEG_ORDER.indexOf(normalised)

  return (
    <div className="dr-track">
      {LEGS.map((leg, i) => {
        const state = at < 0 ? "todo" : i < at ? "done" : i === at ? "now" : "todo"
        const Icon = leg.icon
        return (
          <div className="dr-track-step" key={leg.key} data-state={state}>
            <span className="dr-track-icon">
              <Icon />
            </span>
            <span className="dr-track-caption">{leg.caption}</span>
          </div>
        )
      })}
    </div>
  )
}

/**
 * The vehicle on this trip, drawn as itself.
 *
 * VehicleArt already maps a vehicle_type to one of ten silhouettes, so a Wing
 * Van is not drawn as a tractor trailer. The wheels turn only when the trip
 * says the thing is genuinely moving — a parked unit that animates is telling
 * the driver something untrue.
 */
export function TripVehicle({ vehicleType, status, height = 54, muted = false }) {
  if (!vehicleType) return null
  return (
    <VehicleArt
      type={vehicleType}
      height={height}
      muted={muted}
      animated={status === "in_transit"}
    />
  )
}

/** Initials for the header badge. */
export function initials(name) {
  return String(name || "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
}

export function greeting(d = new Date()) {
  const h = d.getHours()
  if (h < 12) return "Good morning"
  if (h < 18) return "Good afternoon"
  return "Good evening"
}

/* ---- icons: stroked, 16px, one weight ------------------------------- */
const S = {
  width: 15, height: 15, viewBox: "0 0 24 24", fill: "none",
  stroke: "currentColor", strokeWidth: 2,
  strokeLinecap: "round", strokeLinejoin: "round",
}

function IconClipboard() {
  return (
    <svg {...S} aria-hidden="true">
      <path d="M9 3h6v3H9z" />
      <path d="M15 4.5h2a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1h2" />
    </svg>
  )
}
function IconBox() {
  return (
    <svg {...S} aria-hidden="true">
      <path d="M21 8 12 3 3 8v8l9 5 9-5z" />
      <path d="m3 8 9 5 9-5" />
      <path d="M12 13v8" />
    </svg>
  )
}
function IconTruck() {
  return (
    <svg {...S} aria-hidden="true">
      <path d="M3 6h11v9H3z" />
      <path d="M14 9h4l3 3v3h-7z" />
      <circle cx="7" cy="18" r="1.6" />
      <circle cx="17" cy="18" r="1.6" />
    </svg>
  )
}
function IconCheck() {
  return (
    <svg {...S} aria-hidden="true">
      <path d="m5 13 4 4L19 7" />
    </svg>
  )
}
export function IconMark() {
  return (
    <svg {...S} width="17" height="17" aria-hidden="true">
      <path d="M3 7h11v8H3z" />
      <path d="M14 10h3l3 3v2h-6z" />
      <circle cx="7" cy="18" r="1.5" />
      <circle cx="17" cy="18" r="1.5" />
    </svg>
  )
}
