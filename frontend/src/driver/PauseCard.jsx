import { useEffect, useState } from "react"
import { driverPausePhoto } from "./driverApi"
import { Badge } from "./DriverListBits"
import { PAUSE_STATUS, formatMinutes, pauseReasonLabel } from "./supportKinds"

/**
 * One pause request, as the driver reads it: what they reported, what the
 * office has done about it, and the photographs they sent.
 *
 * It is the answer to "did anyone see this?" — the question a driver stopped
 * at the roadside asks — so it says plainly where the request stands, who
 * answered and when, and, once approved, that the delivery is being held and
 * for how long. The buttons offered follow from that: a request nobody has
 * answered can be withdrawn, and a delivery held can be resumed.
 */

const when = (value) =>
  value
    ? new Date(value).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : null

/** One photograph, fetched with the driver's token and opened full-size on a tap. */
function Thumb({ pauseId, photo, onOpen }) {
  const [src, setSrc] = useState(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    driverPausePhoto(pauseId, photo.id)
      .then((url) => { if (live) setSrc(url) })
      .catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [pauseId, photo.id])

  if (failed) return <span className="dr-pause-thumb is-empty">Photo not available</span>
  if (!src) return <span className="dr-pause-thumb is-empty" aria-hidden="true" />
  return (
    <button type="button" className="dr-pause-thumb" onClick={() => onOpen(src)} aria-label="Open photo">
      <img src={src} alt="" />
    </button>
  )
}

/** Requested, answered, resumed: where this request is on the way. */
function Steps({ pause }) {
  const declined = pause.status === "declined"
  const withdrawn = pause.status === "cancelled"
  const answered = pause.status !== "pending" && !withdrawn
  const resumed = pause.status === "resumed"

  const steps = [
    { key: "asked", label: "Requested", time: when(pause.requestedAt), state: "done" },
    withdrawn
      ? { key: "ans", label: "Withdrawn", time: when(pause.resumedAt), state: "done" }
      : {
          key: "ans",
          label: declined ? "Declined" : answered ? "Approved" : "Review",
          time: answered ? when(pause.reviewedAt) : null,
          state: answered ? "done" : "active",
        },
    ...(declined || withdrawn
      ? []
      : [{ key: "res", label: "Resumed", time: resumed ? when(pause.resumedAt) : null, state: resumed ? "done" : answered ? "active" : "todo" }]),
  ]

  return (
    <ol className="dr-pause-steps" aria-label="Progress">
      {steps.map((s) => (
        <li key={s.key} className="dr-pause-step" data-state={s.state} data-tone={s.key === "ans" && declined ? "danger" : undefined}>
          <span className="dr-pause-step-dot" aria-hidden="true" />
          <span className="dr-pause-step-label">{s.label}</span>
          {s.time && <span className="dr-pause-step-time">{s.time}</span>}
        </li>
      ))}
    </ol>
  )
}

export default function PauseCard({ pause, onResume, onWithdraw, busy = false, error = "" }) {
  const [zoom, setZoom] = useState(null)
  const says = PAUSE_STATUS[pause.status] || PAUSE_STATUS.pending
  const held = formatMinutes(pause.pausedMinutes)

  return (
    <section className="dr-pause-card" data-status={pause.status} aria-label="Pause request">
      <header className="dr-pause-head">
        <span className="dr-pause-reason">{pauseReasonLabel(pause.reason)}</span>
        <Badge tone={says.tone}>{says.label}</Badge>
      </header>

      {pause.tripNo && <p className="dr-pause-trip">Run {pause.tripNo}</p>}
      <p className="dr-pause-desc">{pause.description}</p>

      <Steps pause={pause} />

      {pause.status === "approved" && (
        <p className="dr-pause-held" role="status">
          Your delivery is paused{held ? ` for ${held}` : ""}. Tap Resume when you are back on the road.
        </p>
      )}
      {pause.reviewNote && (
        <p className="dr-pause-note">
          <strong>{pause.reviewedByName || "The office"}:</strong> {pause.reviewNote}
        </p>
      )}

      {pause.photos?.length > 0 && (
        <div className="dr-pause-photos">
          {pause.photos.map((p) => (
            <Thumb key={p.id} pauseId={pause.id} photo={p} onOpen={setZoom} />
          ))}
        </div>
      )}

      {error && <div className="dr-err tight" role="alert">{error}</div>}
      {pause.status === "approved" && onResume && (
        <button type="button" className="dr-btn ok" disabled={busy} onClick={onResume}>
          {busy ? "Resuming…" : "Resume delivery"}
        </button>
      )}
      {pause.status === "pending" && onWithdraw && (
        <button type="button" className="dr-btn ghost" disabled={busy} onClick={onWithdraw}>
          {busy ? "Withdrawing…" : "Withdraw request"}
        </button>
      )}

      {zoom && (
        <div className="dr-zoom" role="dialog" aria-modal="true" aria-label="Photo" onClick={() => setZoom(null)}>
          <img src={zoom} alt="Evidence you sent" />
          <span className="dr-zoom-hint">Tap anywhere to close</span>
        </div>
      )}
    </section>
  )
}
