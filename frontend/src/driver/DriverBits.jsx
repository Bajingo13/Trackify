import VehicleArt from "../components/fleet/VehicleArt"
import { InlineSign } from "./NetSign"

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

/** "Apr 8, 2:30 PM" — a scheduled time, or null when there is none to show. */
export function fmtWhen(value) {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

/**
 * "Today, 1:47 PM", "Tomorrow, 9:00 AM", "Oct 24, 9:00 AM": when a run leaves,
 * worded the way a driver plans a day. Null when there is no time to show.
 */
export function fmtDay(value, now = new Date()) {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((day(d) - day(now)) / 86400000)
  if (diff === 0) return `Today, ${time}`
  if (diff === 1) return `Tomorrow, ${time}`
  if (diff === -1) return `Yesterday, ${time}`
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`
}

/** "1h 54m" from minutes; null when the route was never computed. */
export function fmtDuration(minutes) {
  const m = Math.round(Number(minutes))
  if (!Number.isFinite(m) || m <= 0) return null
  const h = Math.floor(m / 60)
  return h ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${m} min`
}

/**
 * Place names arrive fully qualified ("Balayan, Batangas, Calabarzon, 4213,
 * Philippines"). The first part is the name worth reading; the rest is kept
 * for a quieter second line.
 */
export function splitPlace(place) {
  const parts = String(place || "").split(",").map((p) => p.trim()).filter(Boolean)
  return { title: parts[0] || "—", rest: parts.slice(1).join(", ") }
}

/** A figure with its label, for the row of day-at-a-glance tiles. */
export function StatTile({ label, value, unit }) {
  return (
    <div className="dr-stat">
      <span className="dr-stat-label">{label}</span>
      <span className="dr-stat-value">
        {value}
        {unit && <span className="dr-stat-unit"> {unit}</span>}
      </span>
    </div>
  )
}

/**
 * Pickup and delivery as one vertical line, the way a driver reads a run:
 * where it starts, where it ends, and when each is due. Times come only from
 * the ticket's schedule; a ticket saved without one simply shows none.
 *
 * `withStops` adds a quiet "N stops in between" row — the stops themselves,
 * and the button to mark each reached, live in their own card on the trip.
 */
export function RouteTimeline({ trip, withStops = false }) {
  const status = trip.status
  const picked = ["in_transit", "delivered", "returned", "operationally_closed"].includes(status)
  const dropped = status === "delivered" || status === "operationally_closed"
  const stopCount = (trip.stops || []).length
  const points = [
    { key: "o", kind: "pickup", caption: "Pickup", place: trip.origin, time: fmtWhen(trip.scheduledDeparture), done: picked },
    { key: "d", kind: "delivery", caption: "Delivery", place: trip.destination, time: fmtWhen(trip.scheduledArrival), done: dropped },
  ]
  return (
    <ol className="dr-rt">
      {points.map((p, i) => {
        const { title, rest } = splitPlace(p.place)
        return (
          <li key={p.key} className="dr-rt-pt" data-kind={p.kind} data-done={p.done ? "yes" : "no"}>
            <span className="dr-rt-dot" aria-hidden="true" />
            <div className="dr-rt-main">
              <div className="dr-rt-kind">{p.caption}{p.done && <span className="dr-rt-done">{p.kind === "pickup" ? "Picked up" : "Delivered"}</span>}</div>
              <div className="dr-rt-place">{title}</div>
              {rest && <div className="dr-rt-rest">{rest}</div>}
              {withStops && i === 0 && stopCount > 0 && (
                <div className="dr-rt-between">{stopCount} stop{stopCount > 1 ? "s" : ""} in between</div>
              )}
            </div>
            {p.time && <div className="dr-rt-time"><span className="dr-rt-time-cap">Planned</span>{p.time}</div>}
          </li>
        )
      })}
    </ol>
  )
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

/**
 * Under a button that sends something to the office, while there is no
 * internet: the same sign as the floating "No Connection" pill, inline. The
 * button is disabled beside it; what was typed stays in the form. `also` adds
 * one more sentence (a pause request: call the office in an emergency).
 */
export function NeedsInternet({ children = "Sending this", also = null }) {
  return (
    <InlineSign tone="warn" icon="wifiOff" label="No Connection">
      {children} needs the internet. What you entered is kept.{also ? ` ${also}` : ""}
    </InlineSign>
  )
}
