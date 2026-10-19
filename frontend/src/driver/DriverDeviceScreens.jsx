import { useEffect, useRef, useState } from "react"
import { driverDeviceStatus, driverNewRecoveryCodes, driverVerifyDevice } from "./driverApi"

/**
 * Screens for the one-trusted-phone rule (backend devices.service.js).
 *
 * RecoveryCodes — shown once, when codes are made: the driver writes them down.
 * NewPhone      — a phone that is not the driver's trusted one: a recovery code
 *                 moves the account to it, or the office approves it.
 */

const muted = { margin: "0 0 14px", color: "var(--dr-text-2)", lineHeight: 1.5 }
const title = { fontWeight: 800, fontSize: 18, letterSpacing: "-.01em", marginBottom: 8 }

/** The codes, and a confirmation that they are written down before carrying on. */
export function RecoveryCodes({ codes, onDone, doneLabel = "Continue" }) {
  const [kept, setKept] = useState(false)
  return (
    <div className="dr-scroll" style={{ padding: 20 }}>
      <div className="dr-card">
        <div style={title}>Write down your recovery codes</div>
        <p style={muted}>
          If this phone breaks or is lost, sign in on another phone and enter one of these codes.
          Each code works once. Keep them somewhere safe, away from your phone, like your wallet.
          Don&rsquo;t share them with anyone.
        </p>
        <ol
          aria-label="Recovery codes"
          style={{
            display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px", margin: "0 0 16px",
            padding: 14, listStyle: "none", background: "var(--dr-card-2)", borderRadius: 12,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 15, fontWeight: 700,
          }}
        >
          {codes.map((c) => <li key={c}>{c}</li>)}
        </ol>
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 14, lineHeight: 1.4 }}>
          <input type="checkbox" checked={kept} onChange={(e) => setKept(e.target.checked)} />
          <span>I&rsquo;ve written these codes down.</span>
        </label>
        <button className="dr-btn ink" disabled={!kept} onClick={onDone}>{doneLabel}</button>
      </div>
    </div>
  )
}

/** From Profile: make a new set (the PIN is asked again), which cancels the old one. */
export function NewRecoveryCodes({ codesLeft, onDone }) {
  const [pin, setPin] = useState("")
  const [err, setErr] = useState("")
  const [busy, setBusy] = useState(false)
  const [codes, setCodes] = useState(null)

  if (codes) return <RecoveryCodes codes={codes} onDone={onDone} doneLabel="Done" />

  async function submit(e) {
    e.preventDefault()
    setErr("")
    setBusy(true)
    try {
      setCodes((await driverNewRecoveryCodes(pin)).recoveryCodes)
    } catch (e2) {
      setErr(e2.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dr-card">
      <p style={muted}>
        {codesLeft != null ? `You have ${codesLeft} unused code${codesLeft === 1 ? "" : "s"}. ` : ""}
        Make a new set if you&rsquo;ve lost your codes or used most of them. Your old codes will stop working.
      </p>
      <form onSubmit={submit}>
        <label className="dr-label" htmlFor="codes-pin">Enter your PIN</label>
        <div className="dr-loginfield">
          <input
            id="codes-pin"
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            autoComplete="current-password"
          />
        </div>
        <button className="dr-btn ink" style={{ marginTop: 12 }} disabled={busy || pin.length < 4}>
          {busy ? "Making codes…" : "Make new codes"}
        </button>
        {err && <div className="dr-err" role="alert" style={{ marginTop: 12 }}>{err}</div>}
      </form>
    </div>
  )
}

/**
 * This phone gave the right PIN but is not the trusted one. Enter a recovery
 * code, or wait for the office: the screen asks every few seconds whether the
 * office has approved it.
 */
export function NewPhone({ pending, onSignedIn, onCancel }) {
  const [code, setCode] = useState("")
  const [err, setErr] = useState("")
  const [busy, setBusy] = useState(false)
  const [locked, setLocked] = useState(Boolean(pending.locked))
  const [asked, setAsked] = useState(false)

  // The parent hands a new callback on every render; the poll must not restart
  // with it, or a busy screen would never reach its first check. And whichever
  // gets there first — a code or the office — signs in once, not twice.
  const signedInRef = useRef(onSignedIn)
  signedInRef.current = onSignedIn
  const done = useRef(false)
  const finish = (auth, info) => {
    if (done.current) return
    done.current = true
    signedInRef.current(auth, info)
  }

  // The office may approve this phone at any time; ask until it does or the sign-in expires.
  useEffect(() => {
    let dead = false
    const timer = window.setInterval(async () => {
      try {
        const s = await driverDeviceStatus(pending.pendingToken)
        if (dead || done.current) return
        if (s.status === "approved") finish({ token: s.token, driver: pending.driver }, s)
        else if (s.status === "refused") { setErr("This phone wasn't approved. Sign in again or call your office."); window.clearInterval(timer) }
      } catch (e) {
        if (!dead && e.status === 401) { setErr("This sign-in has expired. Sign in again."); window.clearInterval(timer) }
      }
    }, 5000)
    return () => { dead = true; window.clearInterval(timer) }
  }, [pending])

  async function submit(e) {
    e.preventDefault()
    setErr("")
    setBusy(true)
    try {
      const res = await driverVerifyDevice(pending.pendingToken, code)
      finish({ token: res.token, driver: pending.driver }, res)
    } catch (e2) {
      if (e2.status === 423) setLocked(true)
      const left = e2.attemptsLeft
      setErr(left != null && left <= 3 ? `${e2.message} ${left} ${left === 1 ? "try" : "tries"} left.` : e2.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dr-scroll" style={{ padding: 20 }}>
      <div className="dr-card">
        <div style={title}>New phone</div>
        <p style={muted}>
          Your account is set up on another phone. To use it on this phone, enter one of the
          recovery codes you wrote down. Your other phone will be signed out.
        </p>

        {locked ? (
          <div className="dr-err" role="alert" style={{ marginBottom: 14 }}>
            Too many wrong codes. Call your office. They can approve this phone for you.
          </div>
        ) : (
          <form onSubmit={submit} style={{ marginBottom: 16 }}>
            <label className="dr-label" htmlFor="recovery-code">Recovery code</label>
            <div className="dr-loginfield">
              <input
                id="recovery-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="XXXXX-XXXXX"
                autoCapitalize="characters"
                autoCorrect="off"
                autoComplete="one-time-code"
                maxLength={14}
              />
            </div>
            <button className="dr-btn ink" style={{ marginTop: 12 }} disabled={busy || code.replace(/[^0-9A-Z]/gi, "").length < 10}>
              {busy ? "Checking…" : "Use this phone"}
            </button>
          </form>
        )}

        {err && !locked && <div className="dr-err" role="alert" style={{ marginBottom: 14 }}>{err}</div>}

        <div style={{ borderTop: "1px solid var(--dr-line, rgba(127,127,127,.2))", paddingTop: 14 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Don&rsquo;t have your codes?</div>
          {asked ? (
            <p style={muted} role="status">
              Waiting for your office to approve this phone. Keep this screen open. You&rsquo;ll be
              signed in as soon as they do.
            </p>
          ) : (
            <>
              <p style={muted}>
                Call your office and ask them to approve your new phone. They&rsquo;ll check it&rsquo;s you.
              </p>
              <button className="dr-btn ghost" onClick={() => setAsked(true)}>I&rsquo;ve called my office</button>
            </>
          )}
          <button className="dr-btn ghost" style={{ marginTop: 10 }} onClick={onCancel}>Back to sign in</button>
        </div>
      </div>
    </div>
  )
}
