import { useEffect, useState } from "react"
import { driverHistory } from "./driverApi"
import { TripVehicle } from "./DriverBits"

/**
 * Runs already finished.
 *
 * The Today tab deliberately forgets a trip three days after it lands, because
 * carrying old work on the screen you drive from is noise. But the work still
 * happened, and a driver checking a payslip, disputing a delivery, or simply
 * wanting to know how much ground they covered last month had nowhere to look.
 * This is that record, and it is read-only on purpose — nothing here can be
 * edited from the road.
 *
 * Grouped by month rather than listed flat: "what did I do in August" is the
 * shape of the question, and a flat list of forty rows does not answer it.
 */
export default function DriverHistory() {
  const [runs, setRuns] = useState(null)
  const [err, setErr] = useState("")

  useEffect(() => {
    driverHistory().then(setRuns).catch((e) => setErr(e.message))
  }, [])

  if (err) return <div className="dr-scroll"><div className="dr-err">{err}</div></div>
  if (!runs) return <div className="dr-scroll dr-loading">Loading…</div>

  if (!runs.length) {
    return (
      <div className="dr-scroll">
        <div className="dr-empty">
          <div className="dr-empty-title">Nothing finished yet</div>
          <div className="dr-empty-sub">
            Completed runs land here once they are delivered.
          </div>
        </div>
      </div>
    )
  }

  const months = groupByMonth(runs)

  return (
    <div className="dr-scroll">
      {months.map(([month, rows]) => (
        <section key={month}>
          <div className="dr-section">
            <span className="dr-section-title">{month}</span>
            <span className="dr-section-count">
              {rows.length === 1 ? "1 run" : `${rows.length} runs`}
            </span>
          </div>
          {rows.map((r) => (
            <HistoryRow key={r.id} run={r} />
          ))}
        </section>
      ))}

      <p className="dr-foot">
        Showing your {runs.length} most recent finished runs.
      </p>
    </div>
  )
}

/** Newest first, and the API already sorts that way — this only cuts the seams. */
function groupByMonth(runs) {
  const out = new Map()
  for (const r of runs) {
    const when = r.finishedAt || r.scheduledDeparture
    const key = when
      ? new Date(when).toLocaleDateString("en-PH", { month: "long", year: "numeric" })
      : "Undated"
    if (!out.has(key)) out.set(key, [])
    out.get(key).push(r)
  }
  return [...out.entries()]
}

const day = (d) =>
  d ? new Date(d).toLocaleDateString("en-PH", { day: "numeric", month: "short" }) : "—"

function HistoryRow({ run }) {
  // A cancelled run is part of the record but is not an achievement, and
  // showing it in the same weight as a delivery misrepresents the month.
  const cancelled = run.status === "cancelled"

  return (
    <article className="dr-hist" data-cancelled={cancelled ? "yes" : "no"}>
      <span className="dr-hist-art">
        <TripVehicle vehicleType={run.vehicleType} status="delivered" height={28} muted />
      </span>

      <span className="dr-hist-main">
        <span className="dr-hist-top">
          <span className="dr-hist-no">{run.ticketNo}</span>
          <span className="dr-hist-day">{day(run.finishedAt || run.scheduledDeparture)}</span>
        </span>

        <span className="dr-hist-route">
          {shorten(run.origin)} <span className="dr-hist-arrow">→</span> {shorten(run.destination)}
        </span>

        <span className="dr-hist-meta">
          {run.customer && <span>{run.customer}</span>}
          {run.vehicle && <span>{run.vehicle}</span>}
          {run.routeKm != null && <span>{Math.round(Number(run.routeKm))} km</span>}
        </span>

        {run.receivedBy && (
          <span className="dr-hist-pod">Received by {run.receivedBy}</span>
        )}
      </span>

      {cancelled && <span className="dr-pill cancelled">cancelled</span>}
    </article>
  )
}

/** Addresses here are long and the row is narrow; the town is the useful part. */
function shorten(place) {
  if (!place) return "—"
  const first = String(place).split(",")[0].trim()
  return first.length > 22 ? `${first.slice(0, 21)}…` : first
}
