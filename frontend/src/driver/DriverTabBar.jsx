import { tap } from "./native"

/**
 * The bottom navigation.
 *
 * This is the single biggest reason the app read as a web page rather than an
 * app: a web page puts its navigation at the top, where a thumb cannot reach
 * it, and moves you between screens by replacing the whole view. A phone app
 * keeps its destinations at the bottom, always visible, always showing where
 * you are — so the app has a shape you can hold in your head.
 *
 * Four destinations, and no more. A fifth would mean either shrinking the
 * targets below what a thumb can hit at a truck stop, or hiding one behind a
 * "more" tab, which is where features go to be forgotten.
 *
 * Every tab answers a question a driver actually asks:
 *   Today    — what am I driving right now
 *   History  — what have I driven
 *   Claims   — am I getting my money back
 *   Me       — is my licence still valid, and is my number right
 */
export const TABS = [
  { key: "trips", label: "Today", Icon: IconTruck },
  { key: "history", label: "History", Icon: IconRoute },
  { key: "claims", label: "Claims", Icon: IconReceipt },
  { key: "profile", label: "Me", Icon: IconPerson },
]

export default function DriverTabBar({ active, onChange }) {
  return (
    <nav className="dr-tabbar" aria-label="Sections">
      {TABS.map(({ key, label, Icon }) => {
        const on = key === active
        return (
          <button
            key={key}
            type="button"
            className="dr-tab"
            data-on={on ? "yes" : "no"}
            aria-current={on ? "page" : undefined}
            onClick={() => {
              if (on) return
              // a light tick on arrival is most of what makes a tab feel
              // pressed rather than merely clicked
              tap("light")
              onChange(key)
            }}
          >
            <span className="dr-tab-icon">
              <Icon filled={on} />
            </span>
            <span className="dr-tab-label">{label}</span>
          </button>
        )
      })}
    </nav>
  )
}

/* ---- icons ----------------------------------------------------------
 * Stroked at rest, filled when the tab is on. The weight change is what
 * carries the selected state at a glance; colour alone is not enough in
 * direct sunlight, which is where this app is mostly read.
 */
const S = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
}

function IconTruck({ filled }) {
  return (
    <svg {...S} aria-hidden="true">
      <path d="M3 7.5h10.5v8H3z" fill={filled ? "currentColor" : "none"} />
      <path d="M13.5 10.5h3.2l3.3 3.2v1.8h-6.5z" fill={filled ? "currentColor" : "none"} />
      <circle cx="7" cy="17.5" r="1.7" fill={filled ? "currentColor" : "none"} />
      <circle cx="17" cy="17.5" r="1.7" fill={filled ? "currentColor" : "none"} />
    </svg>
  )
}

function IconRoute({ filled }) {
  return (
    <svg {...S} aria-hidden="true">
      <circle cx="6" cy="6" r="2.4" fill={filled ? "currentColor" : "none"} />
      <circle cx="18" cy="18" r="2.4" fill={filled ? "currentColor" : "none"} />
      <path d="M8.4 6H14a3.4 3.4 0 0 1 0 6.8h-4A3.4 3.4 0 0 0 10 18h5.6" />
    </svg>
  )
}

function IconReceipt({ filled }) {
  return (
    <svg {...S} aria-hidden="true">
      <path
        d="M6 3.5h12v17l-2.4-1.6-2.4 1.6-2.4-1.6-2.4 1.6L6 20.5z"
        fill={filled ? "currentColor" : "none"}
      />
      <path d="M9.5 8.5h5M9.5 12h5" stroke={filled ? "var(--dr-surface, #fff)" : "currentColor"} />
    </svg>
  )
}

function IconPerson({ filled }) {
  return (
    <svg {...S} aria-hidden="true">
      <circle cx="12" cy="8" r="3.6" fill={filled ? "currentColor" : "none"} />
      <path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" fill={filled ? "currentColor" : "none"} />
    </svg>
  )
}
