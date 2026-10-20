import { useEffect, useMemo, useState } from "react"
import { driverHistory, driverMe } from "./driverApi"
import { TripVehicle, StatTile } from "./DriverBits"
import { Badge, Chevron, EmptyArt, FindBar, RUN_STATUS } from "./DriverListBits"
import DriverRunDetail from "./DriverRunDetail"
import ChipRow from "./ChipRow"
import "./driver-history.css"
import DriverLoader from "./DriverLoader"

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
 *
 * Search and the filters work on the runs the phone has loaded (the most recent
 * hundred), which is what the footer says. The two figures on top are the
 * server's own totals over every finished run, not a sum of what is on screen.
 */

const LIMIT = 100
const STATUS_ORDER = ["operationally_closed", "cancelled", "delivered", "returned"]

export default function DriverHistory({ detail, onDetail }) {
  const [runs, setRuns] = useState(null)
  const [totals, setTotals] = useState(null)
  const [err, setErr] = useState("")

  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState("all")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")

  useEffect(() => {
    driverHistory(LIMIT).then(setRuns).catch((e) => setErr(e.message))
    // The totals are a nicety: without them the list still stands.
    driverMe().then((me) => setTotals(me.totals)).catch(() => {})
  }, [])

  const shown = useMemo(() => (runs ? filterRuns(runs, { query, status, from, to }) : []), [runs, query, status, from, to])

  if (detail?.run) {
    return <DriverRunDetail run={detail.run} onBack={() => onDetail(null)} />
  }

  if (err) return <div className="dr-scroll"><div className="dr-err">{err}</div></div>
  if (!runs) return <div className="dr-scroll"><DriverLoader variant="screen" label="Loading your runs…" /></div>

  if (!runs.length) {
    return (
      <div className="dr-scroll">
        <Summary totals={totals} />
        <div className="dr-empty">
          <EmptyArt />
          <div className="dr-empty-title">No finished runs yet</div>
          <div className="dr-empty-sub">
            Runs you complete show up here, grouped by month, with their route and delivery record.
          </div>
        </div>
      </div>
    )
  }

  const statuses = new Set(runs.map((r) => r.status))
  const present = STATUS_ORDER.filter((s) => statuses.has(s) && RUN_STATUS[s])
  const activeCount = (status !== "all" ? 1 : 0) + (from ? 1 : 0) + (to ? 1 : 0)
  const filtering = Boolean(query.trim()) || activeCount > 0
  const clear = () => { setQuery(""); setStatus("all"); setFrom(""); setTo("") }
  const months = groupByMonth(shown)

  return (
    <div className="dr-scroll">
      <Summary totals={totals} />

      <div className="dr-history-filters">
        <FindBar
          value={query}
          onChange={setQuery}
          placeholder="Search run, place or vehicle"
          label="Search your finished runs"
          open={open}
          onToggle={() => setOpen((o) => !o)}
          activeCount={activeCount}
        >
          {present.length > 1 && (
            <div className="dr-find-group">
              <span className="dr-label">Status</span>
              <ChipRow label="Run status" className="dr-history-statuses">
                {["all", ...present].map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`dr-chip ${status === s ? "on" : ""}`}
                    aria-pressed={status === s}
                    onClick={() => setStatus(s)}
                  >
                    {s === "all" ? "All" : RUN_STATUS[s].label}
                  </button>
                ))}
              </ChipRow>
            </div>
          )}
          <div className="dr-find-group">
            <span className="dr-label">Date range</span>
            <div className="dr-find-dates dr-history-dates">
              <label>
                <span className="dr-sr-only">From</span>
                <input className="dr-field" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <span className="dr-history-date-separator" aria-hidden="true">to</span>
              <label>
                <span className="dr-sr-only">To</span>
                <input className="dr-field" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
              </label>
            </div>
          </div>
          {filtering && <button type="button" className="dr-find-clear" onClick={clear}>Clear search and filters</button>}
        </FindBar>
      </div>

      {shown.length === 0 ? (
        <div className="dr-empty">
          <EmptyArt />
          <div className="dr-empty-title">No runs match</div>
          <div className="dr-empty-sub">Try a different search, or widen the dates.</div>
          <button type="button" className="dr-btn-quiet dr-empty-action" onClick={clear}>Clear search and filters</button>
        </div>
      ) : (
        months.map(([month, rows]) => (
          <section key={month}>
            <div className="dr-section">
              <span className="dr-section-title">{month}</span>
              <span className="dr-section-count">
                {rows.length === 1 ? "1 run" : `${rows.length} runs`}
              </span>
            </div>
            {rows.map((r) => (
              <HistoryRow key={r.id} run={r} onOpen={() => onDetail({ run: r })} />
            ))}
          </section>
        ))
      )}

      <p className="dr-foot">
        {filtering
          ? `${shown.length} of ${runs.length} finished runs shown.`
          : runs.length >= LIMIT
            ? `Showing your ${runs.length} most recent finished runs.`
            : `${runs.length} finished run${runs.length === 1 ? "" : "s"}.`}
      </p>
    </div>
  )
}

/**
 * Completed runs and the ground they covered — the server's tally over every
 * finished run, so it can be larger than the list. Left out when the figure
 * could not be loaded rather than shown as zero.
 */
function Summary({ totals }) {
  if (!totals) return null
  const km = Number(totals.km)
  return (
    <div className="dr-stats dr-stats-2">
      <StatTile label="Completed runs" value={Number(totals.trips).toLocaleString("en-PH")} />
      <StatTile label="Total distance" value={Number.isFinite(km) ? km.toLocaleString("en-PH") : "—"} unit="km" />
    </div>
  )
}

/** The date a run belongs to: when it finished, else when it was due to leave. */
const when = (r) => r.finishedAt || r.scheduledDeparture

/**
 * Search matches the run number, either end of the route, the vehicle and the
 * customer; the date range is by calendar day, inclusive at both ends.
 */
export function filterRuns(runs, { query = "", status = "all", from = "", to = "" }) {
  const q = query.trim().toLowerCase()
  const start = from ? new Date(`${from}T00:00:00`) : null
  const end = to ? new Date(`${to}T23:59:59.999`) : null
  return runs.filter((r) => {
    if (status !== "all" && r.status !== status) return false
    if (q) {
      const hay = [r.ticketNo, r.origin, r.destination, r.vehicle, r.customer].filter(Boolean).join(" ").toLowerCase()
      if (!hay.includes(q)) return false
    }
    if (start || end) {
      const d = when(r) ? new Date(when(r)) : null
      if (!d || Number.isNaN(d.getTime())) return false
      if (start && d < start) return false
      if (end && d > end) return false
    }
    return true
  })
}

/** Newest first, and the API already sorts that way — this only cuts the seams. */
function groupByMonth(runs) {
  const out = new Map()
  for (const r of runs) {
    const key = when(r)
      ? new Date(when(r)).toLocaleDateString("en-PH", { month: "long", year: "numeric" })
      : "Undated"
    if (!out.has(key)) out.set(key, [])
    out.get(key).push(r)
  }
  return [...out.entries()]
}

const day = (d) =>
  d ? new Date(d).toLocaleDateString("en-PH", { day: "numeric", month: "short" }) : "—"

function HistoryRow({ run, onOpen }) {
  const s = RUN_STATUS[run.status] || { label: String(run.status || "").replace(/_/g, " "), tone: "neutral" }
  const km = run.routeKm != null ? Math.round(Number(run.routeKm)) : null

  return (
    // The same card as Today and Claims: the route and when, then status and facts.
    <button type="button" className="dr-claim tap dr-claim--lead" data-tone={s.tone} onClick={onOpen} aria-label={`${run.ticketNo}, ${s.label}`}>
      <span className="dr-lead-art" aria-hidden="true">
        <TripVehicle vehicleType={run.vehicleType} status="delivered" height={26} muted />
      </span>

      <span className="dr-claim-main">
        <span className="dr-claim-top">
          <span className="dr-claim-cat dr-hist-route">
            {shorten(run.origin)} <span className="dr-hist-arrow">→</span> {shorten(run.destination)}
          </span>
          <span className="dr-claim-amt dr-trip-leaves">{day(when(run))}</span>
        </span>

        <span className="dr-claim-line">
          <Badge tone={s.tone}>{s.label}</Badge>
          <span className="dr-claim-meta">
            <span className="dr-hist-no">{run.ticketNo}</span>
            {run.vehicle && <span>{run.vehicle}</span>}
            {km != null && <span>{km} km</span>}
          </span>
        </span>
      </span>
      <Chevron />
    </button>
  )
}

/** Addresses here are long and the row is narrow; the town is the useful part. */
function shorten(place) {
  if (!place) return "—"
  const first = String(place).split(",")[0].trim()
  return first.length > 22 ? `${first.slice(0, 21)}…` : first
}
