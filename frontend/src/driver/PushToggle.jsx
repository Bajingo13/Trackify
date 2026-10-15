import { useEffect, useState } from "react"
import { disablePush, enablePush, pushState } from "./push"
import { tap } from "./native"

/**
 * "Get a notice on this phone when the office replies". Offered only where it can
 * work: it renders nothing in an app or browser that cannot do it, or when the server
 * has no keys, rather than a switch that would not.
 */
export default function PushToggle() {
  const [state, setState] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState("")

  useEffect(() => {
    let live = true
    pushState().then((s) => { if (live) setState(s) }).catch(() => { if (live) setState("unsupported") })
    return () => { live = false }
  }, [])

  async function change(action) {
    setErr("")
    setBusy(true)
    try {
      setState(await action())
      tap("light")
    } catch (e) {
      setErr(e.message || "Could not change that.")
    } finally {
      setBusy(false)
    }
  }

  // Nothing to show when it cannot be offered, and nothing when the driver has blocked it:
  // a notice that cannot be acted on from here is only noise.
  if (!state || state === "unsupported" || state === "unavailable" || state === "denied") return null

  const bell = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9" /><path d="M10 20a2 2 0 0 0 4 0" />
    </svg>
  )

  return (
    <div className="dr-push" data-state={state}>
      <span className="dr-push-icon">{bell}</span>
      <span className="dr-push-text">
        {state === "on" && <><strong>Notifications are on</strong><span>You will get a notice here when the office replies or decides a pause.</span></>}
        {state === "off" && <><strong>Get notified on this phone</strong><span>A notice when the office replies or decides a pause, even if the app is closed.</span></>}
        {err && <span className="dr-err tight" role="alert">{err}</span>}
      </span>
      {state === "off" && (
        <button type="button" className="dr-pause-mini" disabled={busy} onClick={() => change(enablePush)}>
          {busy ? "…" : "Turn on"}
        </button>
      )}
      {state === "on" && (
        <button type="button" className="dr-pause-mini" disabled={busy} onClick={() => change(disablePush)}>
          {busy ? "…" : "Turn off"}
        </button>
      )}
    </div>
  )
}
