import { useEffect, useState } from "react"
import { driverTrip } from "./driverApi"
import { RouteTimeline, fmtWhen, fmtDuration, splitPlace } from "./DriverBits"
import { Badge, DetailHead, FactList, RUN_STATUS } from "./DriverListBits"

/**
 * One finished run, opened from History.
 *
 * What the list already knows is shown at once. The ticket's own detail — the
 * cargo, the stops and what dispatch wrote on it — is fetched behind that and
 * simply fills in; if it cannot be reached the page stands on what it has.
 *
 * Nothing here is filled in from guesses. The delivery record appears only when
 * somebody signed for the drop, and the system does not store a reason for a
 * cancellation, so a cancelled run says it was cancelled and nothing more.
 */
export default function DriverRunDetail({ run, onBack }) {
  const [more, setMore] = useState(null)

  useEffect(() => {
    let live = true
    driverTrip(run.id).then((t) => { if (live) setMore(t) }).catch(() => {})
    return () => { live = false }
  }, [run.id])

  const s = RUN_STATUS[run.status] || { label: String(run.status || "").replace(/_/g, " "), tone: "neutral" }
  const cancelled = run.status === "cancelled"
  const trip = { ...run, ...(more || {}), status: run.status }
  const km = run.routeKm != null ? Number(run.routeKm) : null
  const stops = more?.stops || []
  const record = run.receivedBy || run.deliveredAt

  return (
    <div className="dr-scroll">
      <DetailHead
        title={run.ticketNo}
        sub={run.customer || null}
        onBack={onBack}
        badge={<Badge tone={s.tone}>{s.label}</Badge>}
      />

      <div className="dr-block">
        <div className="dr-block-body dr-rt-body">
          <RouteTimeline trip={trip} />
        </div>
      </div>

      <div className="dr-info">
        <div className="dr-info-cell">
          <span className="dr-info-label">{cancelled ? "Cancelled" : "Finished"}</span>
          <span className="dr-info-value">{fmtWhen(run.finishedAt) || "—"}</span>
        </div>
        {km != null && Number.isFinite(km) && (
          <div className="dr-info-cell">
            <span className="dr-info-label">Distance</span>
            <span className="dr-info-value">{km.toLocaleString("en-PH", { maximumFractionDigits: 1 })} km</span>
            {fmtDuration(more?.routeMin) && <span className="dr-info-sub">{fmtDuration(more.routeMin)} planned</span>}
          </div>
        )}
        {run.vehicle && (
          <div className="dr-info-cell">
            <span className="dr-info-label">Vehicle</span>
            <span className="dr-info-value">{run.vehicle}</span>
            {run.vehicleType && <span className="dr-info-sub">{run.vehicleType}</span>}
          </div>
        )}
        {more?.cargo && (
          <div className="dr-info-cell">
            <span className="dr-info-label">Cargo</span>
            <span className="dr-info-value">{more.cargo}</span>
          </div>
        )}
      </div>

      {cancelled && <div className="dr-note dr-note-quiet"><span>This run was cancelled.</span></div>}

      {!cancelled && record && (
        <div className="dr-block">
          <div className="dr-block-head"><span className="dr-block-title">Delivery record</span></div>
          <div className="dr-block-body">
            <FactList
              rows={[
                { label: "Received by", value: run.receivedBy },
                { label: "Delivered", value: fmtWhen(run.deliveredAt) },
              ]}
            />
          </div>
        </div>
      )}

      {stops.length > 0 && (
        <div className="dr-block">
          <div className="dr-block-head">
            <span className="dr-block-title">Stops</span>
            <span className="dr-block-meta">{stops.filter((x) => x.arrivedAt).length} of {stops.length} reached</span>
          </div>
          <div className="dr-block-body">
            <ol className="dr-stops">
              {stops.map((x, i) => (
                <li key={x.id ?? i} className="dr-stop" data-done={x.arrivedAt ? "yes" : "no"}>
                  <span className="dr-stop-dot" aria-hidden="true" />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="dr-stop-label">{i + 1}. {splitPlace(x.label).title}</div>
                    <div className="dr-stop-meta">{x.arrivedAt ? `Reached ${fmtWhen(x.arrivedAt)}` : "Not reached"}</div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}

      {more?.instructions && (
        <div className="dr-note">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v5M12 16.5v.01" />
          </svg>
          <span>{more.instructions}</span>
        </div>
      )}
    </div>
  )
}
