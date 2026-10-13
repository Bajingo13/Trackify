import { useEffect, useRef, useState } from "react"
import { tap } from "./native"

/**
 * The bell at the top right of every tab.
 *
 * What a driver needs to be told while they are somewhere else in the app is
 * that dispatch has written. That is the only notification this app has, so it
 * is the only thing listed: one row per trip with unread messages, and a tap
 * opens that conversation. Nothing is invented to fill the panel — with nothing
 * new it says so.
 */
export default function DriverBell({ rows = [], onOpenTrip }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const total = rows.reduce((n, r) => n + r.unread, 0)

  useEffect(() => {
    if (!open) return undefined
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const escape = (e) => { if (e.key === "Escape") setOpen(false) }
    document.addEventListener("pointerdown", away)
    document.addEventListener("keydown", escape)
    return () => {
      document.removeEventListener("pointerdown", away)
      document.removeEventListener("keydown", escape)
    }
  }, [open])

  return (
    <div className="dr-bell" ref={ref}>
      <button
        type="button"
        className="dr-bell-btn"
        aria-label={total ? `Notifications, ${total} new` : "Notifications"}
        aria-expanded={open}
        onClick={() => { tap("light"); setOpen((o) => !o) }}
      >
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z" />
          <path d="M10 20a2 2 0 0 0 4 0" />
        </svg>
        {total > 0 && <span className="dr-bell-badge">{total > 9 ? "9+" : total}</span>}
      </button>

      {open && (
        <div className="dr-bell-pop" role="region" aria-label="Notifications">
          <div className="dr-bell-title">Notifications</div>
          {rows.length === 0 ? (
            <div className="dr-bell-empty">You&rsquo;re all caught up.</div>
          ) : (
            rows.map((r) => (
              <button
                key={r.tripId}
                type="button"
                className="dr-bell-row"
                onClick={() => { setOpen(false); onOpenTrip?.(r.tripId) }}
              >
                <span className="dr-bell-row-main">
                  <span className="dr-bell-row-no">{r.ticketNo || `Trip ${r.tripId}`}</span>
                  <span className="dr-bell-row-sub">
                    {r.unread} new message{r.unread === 1 ? "" : "s"} from dispatch
                  </span>
                </span>
                <span className="dr-bell-row-go" aria-hidden="true">›</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
