import { useCallback, useEffect, useRef, useState } from "react"
import { driverAgreement, driverAcceptAgreement } from "./driverApi"

/**
 * The Driver App does not open until the Agreement is accepted.
 *
 * The staff gate could not serve a driver: it sits inside the web app's
 * protected-route guard, and /driver/* is mounted outside it. So a driver who
 * only ever used the phone accepted nothing, while section 4.3 offered consent
 * as the legal basis for collecting their location under 4.1.1. This is the
 * missing half.
 *
 * It fails closed, like the staff gate. If the acceptance state cannot be read
 * the app does not open — letting a driver in on the assumption they probably
 * accepted is precisely the record this exists to keep. At the roadside that
 * has to come with a way forward, so there is a retry and a way out rather than
 * a dead end.
 */
export default function DriverAgreementGate({ onDecline, children }) {
  const [state, setState] = useState({ status: "loading" })

  const load = useCallback(() => {
    setState({ status: "loading" })
    driverAgreement()
      .then((doc) => setState({ status: doc.accepted ? "accepted" : "review", doc }))
      .catch((err) => setState({ status: "error", error: err.message }))
  }, [])

  useEffect(load, [load])

  if (state.status === "accepted") return children

  if (state.status === "loading") {
    return (
      <div className="dr-scroll" role="status" style={{ padding: 24 }}>
        Loading Trackify…
      </div>
    )
  }

  if (state.status === "error") {
    return (
      <div className="dr-scroll" style={{ padding: 20 }}>
        <div className="dr-card">
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>
            Can&rsquo;t check your agreement
          </div>
          <p style={{ margin: "0 0 14px", color: "var(--dr-text-2)", lineHeight: 1.5 }}>
            Trackify can&rsquo;t confirm whether you&rsquo;ve accepted the Terms of
            Service and Data Privacy Policy, so it hasn&rsquo;t opened.{" "}
            {state.error}
          </p>
          <button className="dr-btn ink" onClick={load}>Try again</button>
          <button
            className="dr-btn"
            style={{ marginTop: 10, background: "transparent" }}
            onClick={onDecline}
          >
            Sign out
          </button>
        </div>
      </div>
    )
  }

  return <Review doc={state.doc} onAccepted={() => setState({ status: "accepted" })} onDecline={onDecline} />
}

function Review({ doc, onAccepted, onDecline }) {
  const [read, setRead] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState("")
  const scroller = useRef(null)

  /**
   * "You must review and accept" — so Accept stays disabled until the document
   * has actually been scrolled through. A tall phone that shows the whole text
   * counts as read immediately, which is why this also runs on mount.
   */
  const checkRead = useCallback(() => {
    const el = scroller.current
    if (!el) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) setRead(true)
  }, [])

  useEffect(checkRead, [checkRead, doc])

  async function onAccept() {
    setSaving(true)
    setErr("")
    try {
      await driverAcceptAgreement()
      onAccepted()
    } catch (e) {
      setErr(e.message || "Your acceptance couldn't be saved. Try again.")
      setSaving(false)
    }
  }

  return (
    <div className="dr-scroll" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: "-.01em" }}>{doc.title}</div>
        <div style={{ fontSize: 12, color: "var(--dr-text-2)", marginTop: 2 }}>
          {doc.systemName} · Version {doc.version}
        </div>
      </div>

      <div
        ref={scroller}
        onScroll={checkRead}
        tabIndex={0}
        role="region"
        aria-label="Agreement text"
        style={{
          flex: "1 1 auto",
          maxHeight: "52vh",
          overflowY: "auto",
          WebkitOverflowScrolling: "touch",
          background: "var(--dr-surface-2, rgba(255,255,255,.04))",
          border: "1px solid var(--dr-line, rgba(255,255,255,.12))",
          borderRadius: 12,
          padding: 14,
          fontSize: 13,
          lineHeight: 1.6,
          color: "var(--dr-text-2)",
        }}
      >
        <p style={{ marginTop: 0 }}>{doc.intro}</p>

        {doc.sections.map((section) => (
          <section key={section.heading} style={{ marginTop: 16 }}>
            <h2
              style={{
                margin: "0 0 6px",
                fontSize: 12,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: ".04em",
                color: "var(--dr-text)",
              }}
            >
              {section.heading}
            </h2>
            {(section.paragraphs || []).map((p) => (
              <p key={p} style={{ margin: "0 0 8px" }}>{p}</p>
            ))}
            {section.items && (
              <ul style={{ margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 6 }}>
                {section.items.map((item) => <li key={item}>{item}</li>)}
              </ul>
            )}
          </section>
        ))}
      </div>

      <p style={{ margin: 0, fontWeight: 600, fontSize: 13, lineHeight: 1.5 }}>
        {doc.acceptanceStatement}
      </p>

      {!read && (
        <p style={{ margin: 0, fontSize: 12, color: "var(--dr-text-2)" }}>
          Scroll to the end to continue.
        </p>
      )}

      {err && <div className="dr-err">{err}</div>}

      <button className="dr-btn ink" onClick={onAccept} disabled={!read || saving}>
        {saving ? "Saving…" : "I have read and accept"}
      </button>
      {/* Declining is not handled quietly: the Agreement says someone who does
          not agree must stop using the System, so it signs out. */}
      <button
        className="dr-btn"
        style={{ background: "transparent" }}
        onClick={onDecline}
        disabled={saving}
      >
        I do not agree — sign out
      </button>
    </div>
  )
}
