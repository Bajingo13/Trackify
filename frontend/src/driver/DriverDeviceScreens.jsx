import { useEffect, useRef, useState } from "react"
import { driverAskOffice, driverDeviceStatus, driverResendCode, driverVerifyDevice } from "./driverApi"

/**
 * The screen for the one-trusted-phone rule (backend devices.service.js).
 *
 * VerifyPhone — this phone gave the right PIN but is not yet trusted: a new
 *               account's first phone, or a move to another phone. A code was
 *               emailed the moment the PIN was right; entering it signs in.
 *               A driver who can't get the email asks the office instead, and
 *               the screen signs in by itself as soon as the office approves.
 */

const muted = { margin: "0 0 14px", color: "var(--dr-text-2)", lineHeight: 1.5 }
const title = { fontWeight: 800, fontSize: 18, letterSpacing: "-.01em", marginBottom: 8 }
const divider = { borderTop: "1px solid var(--dr-line, rgba(127,127,127,.2))", paddingTop: 14 }

const COOLDOWN = 60

export function VerifyPhone({ pending, onSignedIn, onCancel }) {
  const emailOnFile = Boolean(pending.emailHint)
  const [code, setCode] = useState("")
  const [err, setErr] = useState(pending.emailError || "")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [locked, setLocked] = useState(Boolean(pending.locked))
  // Without an email, or locked out, the server has already asked the office.
  const [asked, setAsked] = useState(!emailOnFile || Boolean(pending.locked))
  const [wait, setWait] = useState(pending.emailSent ? COOLDOWN : 0)
  const inputRef = useRef(null)

  // The parent hands a new callback on every render; the poll must not restart
  // with it, or a busy screen would never reach its first check. And whichever
  // gets there first — the code or the office — signs in once, not twice.
  const signedInRef = useRef(onSignedIn)
  signedInRef.current = onSignedIn
  const done = useRef(false)
  const finish = (auth) => {
    if (done.current) return
    done.current = true
    signedInRef.current(auth)
  }

  // The office may approve this phone at any time; ask until it does or the sign-in expires.
  useEffect(() => {
    let dead = false
    const timer = window.setInterval(async () => {
      try {
        const s = await driverDeviceStatus(pending.pendingToken)
        if (dead || done.current) return
        if (s.status === "approved") finish({ token: s.token, driver: pending.driver })
        else if (s.status === "refused") { setErr("This phone wasn't approved. Sign in again or call your office."); window.clearInterval(timer) }
      } catch (e) {
        if (!dead && e.status === 401) { setErr("This sign-in has expired. Sign in again."); window.clearInterval(timer) }
      }
    }, 5000)
    return () => { dead = true; window.clearInterval(timer) }
  }, [pending])

  // The resend button counts down from the last email.
  useEffect(() => {
    if (wait <= 0) return undefined
    const id = window.setTimeout(() => setWait((w) => w - 1), 1000)
    return () => window.clearTimeout(id)
  }, [wait])

  async function check(value) {
    if (busy || value.length !== 6) return
    setErr("")
    setNote("")
    setBusy(true)
    try {
      const res = await driverVerifyDevice(pending.pendingToken, value)
      finish({ token: res.token, driver: pending.driver })
    } catch (e) {
      if (e.status === 423) { setLocked(true); setAsked(true) }
      const left = e.attemptsLeft
      setErr(left != null && left > 0 && left <= 3 ? `${e.message} ${left} ${left === 1 ? "try" : "tries"} left.` : e.message)
      setCode("")
      inputRef.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  function type(e) {
    const value = e.target.value.replace(/\D/g, "").slice(0, 6)
    setCode(value)
    // Six digits is the whole code: no button to find.
    if (value.length === 6) check(value)
  }

  async function resend() {
    setErr("")
    setNote("")
    try {
      await driverResendCode(pending.pendingToken)
      setWait(COOLDOWN)
      setCode("")
      setNote(`We sent a new code to ${pending.emailHint}. The old one no longer works.`)
      inputRef.current?.focus()
    } catch (e) {
      if (e.retryAfter) setWait(e.retryAfter)
      setErr(e.message)
    }
  }

  async function askOffice() {
    setErr("")
    try {
      await driverAskOffice(pending.pendingToken)
      setAsked(true)
    } catch (e) {
      setErr(e.message)
    }
  }

  const heading = pending.firstPhone ? "Check your email" : "New phone"
  const lead = !emailOnFile
    ? "There's no email on file for you, so your office needs to approve this phone."
    : pending.firstPhone
      ? <>We sent a 6-digit code to <b>{pending.emailHint}</b>. Enter it to finish signing in.</>
      : <>Your account is set up on another phone. We sent a 6-digit code to <b>{pending.emailHint}</b>. Enter it to use this phone instead. Your other phone will be signed out.</>

  return (
    <div className="dr-scroll" style={{ padding: 20 }}>
      <div className="dr-card">
        <div style={title}>{heading}</div>
        <p style={muted}>{lead}</p>

        {locked ? (
          <div className="dr-err" role="alert" style={{ marginBottom: 14 }}>
            Too many wrong codes. Call your office. They can approve this phone for you.
          </div>
        ) : emailOnFile && (
          <div style={{ marginBottom: 16 }}>
            <label className="dr-label" htmlFor="device-code">Code from your email</label>
            <div className="dr-loginfield">
              <input
                id="device-code"
                ref={inputRef}
                value={code}
                onChange={type}
                placeholder="000000"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                autoFocus
                maxLength={6}
                disabled={busy}
                style={{ letterSpacing: "0.4em", fontWeight: 700, fontSize: 20 }}
              />
            </div>
            <p style={{ ...muted, margin: "8px 0 0", fontSize: 13 }}>
              {busy ? "Checking…" : `The code works once, for ${pending.codeMinutes || 10} minutes.`}
            </p>
            <button className="dr-btn ghost" style={{ marginTop: 10 }} onClick={resend} disabled={wait > 0}>
              {wait > 0 ? `Send a new code in ${wait}s` : "Send a new code"}
            </button>
          </div>
        )}

        {note && !err && <div role="status" style={{ ...muted, fontSize: 13 }}>{note}</div>}
        {err && !locked && <div className="dr-err" role="alert" style={{ marginBottom: 14 }}>{err}</div>}

        <div style={divider}>
          {asked ? (
            <p style={muted} role="status">
              Waiting for your office to approve this phone. Keep this screen open. You&rsquo;ll be
              signed in as soon as they do.{!emailOnFile || locked ? " Call them so they know it's you." : ""}
            </p>
          ) : (
            <>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Can&rsquo;t get the email?</div>
              <p style={muted}>Ask your office to approve this phone. They&rsquo;ll call you to check it&rsquo;s you.</p>
              <button className="dr-btn ghost" onClick={askOffice}>Ask my office</button>
            </>
          )}
          <button className="dr-btn ghost" style={{ marginTop: 10 }} onClick={onCancel}>Back to sign in</button>
        </div>
      </div>
    </div>
  )
}
