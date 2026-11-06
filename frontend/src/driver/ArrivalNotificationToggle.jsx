import { useState } from "react"
import {
  arrivalNotificationsAvailable,
  arrivalNotificationsEnabled,
  disableArrivalNotifications,
  enableArrivalNotifications,
} from "./arrivalNotifications"
import { tap } from "./native"

export default function ArrivalNotificationToggle() {
  const [on, setOn] = useState(arrivalNotificationsEnabled)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState("")

  if (!arrivalNotificationsAvailable()) return null

  async function toggle() {
    setBusy(true)
    setErr("")
    try {
      const next = on ? disableArrivalNotifications() : await enableArrivalNotifications()
      setOn(next)
      tap("light")
    } catch (e) {
      setErr(e.message || "Could not change arrival notifications.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dr-profile-theme-box dr-profile-box dr-arrival-notification-setting">
      <span className="dr-profile-theme-copy">
        <span className="dr-profile-theme-title">Arrival notification</span>
        <span className="dr-profile-theme-detail">
          Alert me when I’m near the drop-off while the app is in the background or the phone is locked.
        </span>
        {err && <span className="dr-err tight" role="alert">{err}</span>}
      </span>
      <button
        type="button"
        className="dr-profile-theme-switch"
        role="switch"
        aria-label="Arrival notification"
        aria-checked={on}
        data-on={on ? "yes" : "no"}
        disabled={busy}
        onClick={toggle}
      >
        <span className="dr-profile-theme-thumb" aria-hidden="true">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9" />
            <path d="M10 19a2 2 0 0 0 4 0" />
          </svg>
        </span>
      </button>
    </div>
  )
}
