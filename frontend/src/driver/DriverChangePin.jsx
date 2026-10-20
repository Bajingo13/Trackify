import { useState } from "react"
import { driverChangePin } from "./driverApi"
import { notifySuccess } from "./native"

/**
 * Profile → Change PIN.
 *
 * The current PIN first, so a phone left unlocked isn't enough to take the
 * account; then the new one twice. The server has the last word on what is
 * too easy to guess (shared/driverPin.js); the checks here only save a round
 * trip for the obvious ones.
 */

const muted = { margin: "0 0 14px", color: "var(--dr-text-2)", lineHeight: 1.5 }
const digits = (v) => v.replace(/\D/g, "").slice(0, 6)

function PinField({ id, label, value, onChange, autoComplete, autoFocus }) {
  return (
    <>
      <label className="dr-label" htmlFor={id}>{label}</label>
      <div className="dr-loginfield" style={{ marginBottom: 12 }}>
        <input
          id={id}
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          value={value}
          onChange={(e) => onChange(digits(e.target.value))}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
        />
      </div>
    </>
  )
}

export default function DriverChangePin({ email, onDone }) {
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [again, setAgain] = useState("")
  const [err, setErr] = useState("")
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)

  const problem =
    next.length > 0 && next.length < 4 ? "Your new PIN must be 4 to 6 digits."
      : again && next !== again ? "The new PINs don't match."
        : next && next === current ? "Your new PIN must be different from your current one."
          : ""
  const ready = current.length >= 4 && next.length >= 4 && next === again && !problem

  async function submit(e) {
    e.preventDefault()
    if (!ready || busy) return
    setErr("")
    setBusy(true)
    try {
      const res = await driverChangePin(current, next)
      notifySuccess()
      setDone(res || {})
    } catch (e2) {
      setErr(e2.message)
      if (e2.status === 403) setCurrent("")
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="dr-card" role="status">
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 8 }}>PIN changed</div>
        <p style={muted}>
          Use your new PIN next time you sign in.
          {done.emailed && email ? ` We've sent a notice to ${email}.` : ""}
        </p>
        <button className="dr-btn ink" onClick={onDone}>Done</button>
      </div>
    )
  }

  return (
    <form className="dr-card" onSubmit={submit}>
      <p style={muted}>Choose a PIN only you know. Don&rsquo;t use your birthday or digits in order, like 1234.</p>
      <PinField id="pin-current" label="Current PIN" value={current} onChange={setCurrent} autoComplete="current-password" autoFocus />
      <PinField id="pin-new" label="New PIN (4 to 6 digits)" value={next} onChange={setNext} autoComplete="new-password" />
      <PinField id="pin-again" label="Type the new PIN again" value={again} onChange={setAgain} autoComplete="new-password" />
      {(problem || err) && <div className="dr-err" role="alert" style={{ marginBottom: 12 }}>{err || problem}</div>}
      <button className="dr-btn ink" disabled={!ready || busy}>{busy ? "Changing…" : "Change PIN"}</button>
      <p style={{ ...muted, margin: "12px 0 0", fontSize: 13 }}>
        Forgot your current PIN? Ask your office to email you a new one.
      </p>
    </form>
  )
}
