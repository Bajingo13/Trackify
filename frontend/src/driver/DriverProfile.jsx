import { useEffect, useRef, useState } from "react"
import {
  driverMe,
  driverUpdateMe,
  driverUploadPhoto,
  driverRemovePhoto,
  driverBlobUrl,
} from "./driverApi"
import { initials } from "./DriverBits"
import { tap, notifySuccess } from "./native"

/**
 * The driver's own account.
 *
 * Built around the two things a driver genuinely needs from a screen like this:
 * proof of who they are, and a licence they can check the date on without
 * digging the card out of their wallet. Everything else here earns its place by
 * being something they can act on.
 *
 * The licence is shown and not editable. It is a compliance record the company
 * is audited against, and a driver correcting their own expiry date is exactly
 * the hole an auditor looks for. Their phone number and next of kin are the
 * opposite: nobody else is in a position to keep those right.
 */
export default function DriverProfile({ onSignOut }) {
  const [me, setMe] = useState(null)
  const [err, setErr] = useState("")

  useEffect(() => {
    driverMe().then(setMe).catch((e) => setErr(e.message))
  }, [])

  if (err) return <div className="dr-scroll"><div className="dr-err">{err}</div></div>
  if (!me) return <div className="dr-scroll dr-loading">Loading…</div>

  return (
    <div className="dr-scroll">
      <IdentityCard me={me} onChange={setMe} />
      <LicenceCard licence={me.license} />
      <Totals totals={me.totals} />
      <ContactForm me={me} onSaved={setMe} />

      <button type="button" className="dr-signout" onClick={onSignOut}>
        Sign out
      </button>
      <p className="dr-foot">
        {me.company}
        {me.branch ? ` · ${me.branch}` : ""}
      </p>
    </div>
  )
}

/* ---------------------------------------------------------------- */
/* Identity                                                         */
/* ---------------------------------------------------------------- */

function IdentityCard({ me, onChange }) {
  const [src, setSrc] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState("")
  const file = useRef(null)

  // The photo is behind auth, so it cannot be an <img src> pointed at the API.
  // It is fetched as a blob and revoked on the way out — without the revoke,
  // every profile visit leaks one until the app is closed.
  useEffect(() => {
    let dead = false
    let url = null
    if (!me.hasPhoto) { setSrc(null); return undefined }
    driverBlobUrl("/me/photo").then((u) => {
      if (dead) { if (u) URL.revokeObjectURL(u); return }
      url = u
      setSrc(u)
    })
    return () => {
      dead = true
      if (url) URL.revokeObjectURL(url)
    }
    // photoUpdatedAt changes when a new photo is saved, which is what makes a
    // replacement actually appear rather than showing the old blob again
  }, [me.hasPhoto, me.photoUpdatedAt])

  async function pick(e) {
    const chosen = e.target.files?.[0]
    e.target.value = ""
    if (!chosen) return
    setBusy(true)
    setErr("")
    try {
      const updated = await driverUploadPhoto(chosen)
      notifySuccess()
      onChange(updated)
    } catch (ex) {
      setErr(ex.message)
    } finally {
      setBusy(false)
    }
  }

  async function drop() {
    setBusy(true)
    setErr("")
    try {
      onChange(await driverRemovePhoto())
    } catch (ex) {
      setErr(ex.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="dr-me-card">
      <div className="dr-me-top">
        <span className="dr-me-face">
          {src ? (
            <img src={src} alt="" />
          ) : (
            <span className="dr-me-initials">{initials(me.name) || "—"}</span>
          )}
          {busy && <span className="dr-me-busy" aria-hidden="true" />}
        </span>

        <span className="dr-me-who">
          <span className="dr-me-name">{me.name}</span>
          <span className="dr-me-no">{me.employeeNo || "No employee number"}</span>
          <span className={`dr-pill ${me.status}`}>{me.status.replace(/_/g, " ")}</span>
        </span>
      </div>

      <div className="dr-me-actions">
        <button
          type="button"
          className="dr-btn-quiet"
          disabled={busy}
          onClick={() => { tap("light"); file.current?.click() }}
        >
          {me.hasPhoto ? "Change photo" : "Add photo"}
        </button>
        {me.hasPhoto && (
          <button type="button" className="dr-btn-quiet danger" disabled={busy} onClick={drop}>
            Remove
          </button>
        )}
        {/* accept + capture so Android offers the camera first, and the gallery
            second, rather than a file browser */}
        <input
          ref={file}
          type="file"
          accept="image/*"
          capture="user"
          hidden
          onChange={pick}
        />
      </div>

      {err && <div className="dr-err tight">{err}</div>}
    </section>
  )
}

/* ---------------------------------------------------------------- */
/* Licence                                                          */
/* ---------------------------------------------------------------- */

const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleDateString("en-PH", { day: "numeric", month: "short", year: "numeric" })
    : "—"

/**
 * How the expiry reads.
 *
 * The thresholds are the ones that matter operationally rather than round
 * numbers: an expired licence means the driver cannot legally be dispatched
 * today, and 60 days is roughly how long an LTO renewal takes to come back if
 * it goes wrong, so that is when it stops being paperwork and starts being a
 * problem.
 */
function expiryTone(daysLeft) {
  if (daysLeft == null) return { tone: "none", say: "No expiry recorded" }
  if (daysLeft < 0) return { tone: "danger", say: `Expired ${Math.abs(daysLeft)} days ago` }
  if (daysLeft === 0) return { tone: "danger", say: "Expires today" }
  if (daysLeft <= 60) return { tone: "warn", say: `Expires in ${daysLeft} days` }
  return { tone: "ok", say: `Valid for ${daysLeft} more days` }
}

function LicenceCard({ licence }) {
  const { tone, say } = expiryTone(licence.daysLeft)

  return (
    <section className="dr-lic" data-tone={tone}>
      <div className="dr-lic-head">
        <span className="dr-lic-label">Driver&rsquo;s licence</span>
        {licence.type && <span className="dr-lic-type">{licence.type}</span>}
      </div>

      <div className="dr-lic-no">{licence.no || "Not recorded"}</div>

      <div className="dr-lic-foot">
        <span className="dr-lic-exp">
          <span className="dr-lic-exp-label">Expires</span>
          <span className="dr-lic-exp-date">{fmtDate(licence.expiry)}</span>
        </span>
        <span className="dr-lic-flag">{say}</span>
      </div>

      {tone !== "ok" && tone !== "none" && (
        <p className="dr-lic-note">
          Renewals go through the office — this cannot be changed from the app.
        </p>
      )}
    </section>
  )
}

/* ---------------------------------------------------------------- */
/* Record                                                           */
/* ---------------------------------------------------------------- */

function Totals({ totals }) {
  return (
    <section className="dr-stats">
      <div className="dr-stat">
        <span className="dr-stat-n">{totals.trips.toLocaleString("en-PH")}</span>
        <span className="dr-stat-l">Runs completed</span>
      </div>
      <div className="dr-stat">
        <span className="dr-stat-n">
          {totals.km.toLocaleString("en-PH")}
          <span className="dr-stat-u">km</span>
        </span>
        <span className="dr-stat-l">Distance driven</span>
      </div>
    </section>
  )
}

/* ---------------------------------------------------------------- */
/* What the driver may change                                       */
/* ---------------------------------------------------------------- */

function ContactForm({ me, onSaved }) {
  const [form, setForm] = useState({
    phone: me.phone || "",
    emergencyName: me.emergency.name || "",
    emergencyPhone: me.emergency.phone || "",
    emergencyRelation: me.emergency.relation || "",
  })
  const [state, setState] = useState("idle") // idle | saving | saved
  const [err, setErr] = useState("")

  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }))
    setState("idle")
  }

  async function save(e) {
    e.preventDefault()
    setState("saving")
    setErr("")
    try {
      onSaved(await driverUpdateMe(form))
      notifySuccess()
      setState("saved")
    } catch (ex) {
      setErr(ex.message)
      setState("idle")
    }
  }

  return (
    <form className="dr-form" onSubmit={save}>
      <div className="dr-section">
        <span className="dr-section-title">Contact</span>
      </div>

      <label className="dr-field">
        <span className="dr-label">Your mobile number</span>
        <input
          className="dr-input"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={form.phone}
          onChange={set("phone")}
          placeholder="09XX XXX XXXX"
        />
      </label>

      <div className="dr-section">
        <span className="dr-section-title">If something happens</span>
      </div>
      <p className="dr-hint">
        Who the office calls. Worth keeping right — it is the only number they
        have if you cannot answer yours.
      </p>

      <label className="dr-field">
        <span className="dr-label">Name</span>
        <input
          className="dr-input"
          value={form.emergencyName}
          onChange={set("emergencyName")}
          placeholder="Full name"
        />
      </label>

      <div className="dr-field-row">
        <label className="dr-field">
          <span className="dr-label">Their number</span>
          <input
            className="dr-input"
            type="tel"
            inputMode="tel"
            value={form.emergencyPhone}
            onChange={set("emergencyPhone")}
            placeholder="09XX XXX XXXX"
          />
        </label>
        <label className="dr-field">
          <span className="dr-label">Relation</span>
          <input
            className="dr-input"
            value={form.emergencyRelation}
            onChange={set("emergencyRelation")}
            placeholder="Spouse"
          />
        </label>
      </div>

      {err && <div className="dr-err tight">{err}</div>}

      <button className="dr-btn" type="submit" disabled={state === "saving"}>
        {state === "saving" ? "Saving…" : state === "saved" ? "Saved" : "Save changes"}
      </button>
    </form>
  )
}
