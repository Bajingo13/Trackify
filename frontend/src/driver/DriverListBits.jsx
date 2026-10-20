/**
 * The small pieces History and Claims share, so the two read as one design:
 * the same status badge, the same search and filter bar, the same detail
 * header, the same label-and-value list.
 */

const S = {
  width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
  strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true,
}

/** How the system's statuses read to a driver, and the tone each badge takes. */
export const RUN_STATUS = {
  delivered: { label: "Delivered", tone: "ok" },
  operationally_closed: { label: "Closed", tone: "ok" },
  returned: { label: "Returned", tone: "wait" },
  cancelled: { label: "Cancelled", tone: "neutral" },
}

/**
 * A run still on the driver's list, as Today and the claim form show it.
 * Named for what the driver does next, not the dispatch term: "Released"
 * means nothing on the road; "Ready to start" says what to do.
 */
export const TRIP_STATUS = {
  assigned: { label: "Assigned", tone: "info" },
  accepted: { label: "Accepted", tone: "info" },
  released: { label: "Ready to start", tone: "wait" },
  in_transit: { label: "On the road", tone: "info" },
  delivered: { label: "Delivered", tone: "ok" },
  ...RUN_STATUS,
}

/** The badge for a run, a pause on it taking precedence over its status. */
export function tripBadge(status, pauseStatus) {
  if (status === "in_transit" && pauseStatus === "approved") return { label: "Paused", tone: "wait" }
  if (status === "in_transit" && pauseStatus === "pending") return { label: "Pause requested", tone: "wait" }
  return TRIP_STATUS[status] || { label: String(status || "").replace(/_/g, " "), tone: "neutral" }
}

/** One badge for every status in both modules. Tone is the only thing that varies. */
export function Badge({ tone = "neutral", children }) {
  return <span className="dr-badge" data-tone={tone}>{children}</span>
}

/**
 * Search, and a button for the rest of the filters.
 *
 * The filters themselves differ between modules, so they are the caller's
 * children: this only owns the row and the open/closed panel under it.
 */
export function FindBar({ value, onChange, placeholder, label, open, onToggle, activeCount = 0, children }) {
  return (
    <div className="dr-find">
      <div className="dr-find-row">
        <label className="dr-find-box">
          <svg {...S}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <span className="dr-sr-only">{label}</span>
          <input
            className="dr-find-input"
            type="search"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
        <button
          type="button"
          className="dr-find-btn"
          aria-expanded={open}
          aria-label={activeCount ? `Filters, ${activeCount} active` : "Filters"}
          data-on={open || activeCount > 0 ? "yes" : "no"}
          onClick={onToggle}
        >
          <svg {...S}><path d="M4 6h16M7 12h10M10 18h4" /></svg>
          {activeCount > 0 && <span className="dr-find-count">{activeCount}</span>}
        </button>
      </div>
      {open && <div className="dr-find-panel">{children}</div>}
    </div>
  )
}

/** The header of a record opened from a list: back, what it is, and its status. */
export function DetailHead({ title, sub, onBack, badge }) {
  return (
    <div className="dr-detail-head">
      <button type="button" className="dr-back" onClick={onBack} aria-label="Back">
        <svg {...S} width="17" height="17" strokeWidth="2.2"><path d="m15 18-6-6 6-6" /></svg>
      </button>
      <span className="dr-detail-title">
        <span className="dr-detail-no">{title}</span>
        {sub && <span className="dr-detail-sub">{sub}</span>}
      </span>
      {badge}
    </div>
  )
}

/** Label on the left, value on the right; a row with no value is not drawn. */
export function FactList({ rows }) {
  const shown = rows.filter((r) => r.value != null && r.value !== "")
  if (!shown.length) return null
  return (
    <dl className="dr-facts">
      {shown.map((r) => (
        <div className="dr-fact" key={r.label}>
          <dt>{r.label}</dt>
          <dd>{r.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** A road with nothing on it; static, because nothing is happening. */
export function EmptyArt() {
  return (
    <svg className="dr-empty-art" width="120" height="40" viewBox="0 0 120 40" fill="none" aria-hidden="true">
      <line x1="8" y1="26" x2="112" y2="26" stroke="var(--dr-line)" strokeWidth="2" strokeLinecap="round" />
      <circle cx="8" cy="26" r="4" fill="var(--dr-card)" stroke="var(--dr-line)" strokeWidth="2" />
      <circle cx="112" cy="26" r="4" fill="var(--dr-card)" stroke="var(--dr-line)" strokeWidth="2" />
      <line x1="34" y1="26" x2="46" y2="26" stroke="var(--dr-line-soft)" strokeWidth="2" strokeLinecap="round" />
      <line x1="58" y1="26" x2="70" y2="26" stroke="var(--dr-line-soft)" strokeWidth="2" strokeLinecap="round" />
      <line x1="82" y1="26" x2="94" y2="26" stroke="var(--dr-line-soft)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export const Chevron = () => (
  <svg {...S} width="16" height="16" className="dr-chev"><path d="m9 18 6-6-6-6" /></svg>
)
