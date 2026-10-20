import { useCallback, useEffect, useState } from "react"
import {
  driverMe,
  driverUpdateMe,
  driverUploadPhoto,
  driverRemovePhoto,
  driverBlobUrl,
  driverTrips,
} from "./driverApi"
import PhotoPick from "./PhotoPick"
import DriverChangePin from "./DriverChangePin"
import DriverSupport from "./DriverSupport"
import ProfileThemeSwitch from "./ProfileThemeSwitch"
import { fmtDate, expiryTone, licenceState } from "./licenceExpiry"
import { initials } from "./DriverBits"
import { tap, notifySuccess } from "./native"
import DriverLoader from "./DriverLoader"
import { Badge, Chevron } from "./DriverListBits"

/**
 * The driver's own account.
 *
 * Built around the two things a driver genuinely needs from a screen like this:
 * proof of who they are, and a licence they can check the date on without
 * digging the card out of their wallet. Everything else here earns its place by
 * being something they can act on.
 *
 * The licence is shown and not editable. It is a compliance record the company
 * is audited against — the expiry decides whether the driver may be dispatched —
 * and a driver changing their own expiry date is exactly the hole an auditor
 * looks for. The office adds and changes it in the back office, and this screen
 * reads the same record, so the two can never disagree. Their phone number and
 * next of kin are the opposite: nobody else is in a position to keep those right.
 */
export default function DriverProfile({
  onSignOut,
  onOpenHistory,
  view: controlledView,
  onViewChange,
  onProfile,
  detail,
  onDetail,
  supportUnread = 0,
}) {
  const [me, setMe] = useState(null)
  const [trips, setTrips] = useState([])
  const [tripsState, setTripsState] = useState("loading")
  const [err, setErr] = useState("")
  const [localView, setLocalView] = useState("overview")

  const view = controlledView ?? localView
  const setView = onViewChange ?? setLocalView

  const loadProfile = useCallback(() => {
    setErr("")
    setMe(null)
    setTrips([])
    setTripsState("loading")
    driverMe().then(setMe).catch((e) => setErr(e.message))
    driverTrips()
      .then((rows) => { setTrips(rows); setTripsState("ready") })
      .catch(() => setTripsState("error"))
  }, [])

  useEffect(loadProfile, [loadProfile])

  // The licence is the office's, and the office can change it while this screen
  // is open — a renewal entered, a photo replaced. Re-read it quietly (no blank
  // screen) on returning to the app and once a minute, so what the driver sees
  // follows the office's record rather than whatever was loaded at sign-in.
  useEffect(() => {
    const refresh = () => driverMe().then(setMe).catch(() => { /* keep what is shown */ })
    const id = window.setInterval(refresh, 60000)
    const onVisible = () => { if (document.visibilityState === "visible") refresh() }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [])

  // Home shows this driver's picture, so it is told whenever the record changes
  // here — a new photo, a removed one, an edited detail.
  useEffect(() => { if (me) onProfile?.(me) }, [me, onProfile])

  // Help & Support does not need the profile to have loaded: a driver whose
  // profile will not load (no signal, say) is exactly who may need to ask for help.
  if (view === "support") {
    return <DriverSupport detail={detail} onDetail={onDetail ?? (() => {})} onBack={() => setView("overview")} />
  }

  if (err) return <ProfileLoadError message={err} onRetry={loadProfile} />
  if (!me) return <ProfileLoading />

  const currentTrip = trips.find((trip) => ["assigned", "accepted", "released", "in_transit"].includes(trip.status))

  if (view === "licence") {
    return (
      <ProfileDetail title="Driver's licence" subtitle="Review your compliance record" onBack={() => setView("overview")}>
        <LicenceCard licence={me.license} />
      </ProfileDetail>
    )
  }

  if (view === "pin") {
    return (
      <ProfileDetail title="Change PIN" subtitle="The PIN you sign in with" onBack={() => setView("overview")}>
        <DriverChangePin email={me.email} onDone={() => setView("overview")} />
      </ProfileDetail>
    )
  }

  if (view === "personal") {
    return (
      <ProfileDetail title="Personal information" subtitle="Keep your contact details current" onBack={() => setView("overview")}>
        <ContactForm key="personal" me={me} onSaved={setMe} section="personal" />
      </ProfileDetail>
    )
  }

  if (view === "emergency") {
    return (
      <ProfileDetail title="Emergency contact" subtitle="Who the office should call" onBack={() => setView("overview")}>
        <ContactForm key="emergency" me={me} onSaved={setMe} section="emergency" />
      </ProfileDetail>
    )
  }

  if (view === "work") {
    return (
      <ProfileDetail title="Work information" subtitle="Your current driver record" onBack={() => setView("overview")}>
        <WorkInformation
          me={me}
          currentTrip={currentTrip}
          tripsState={tripsState}
        />
      </ProfileDetail>
    )
  }

  const licenceState = licenceRowState(me.license)
  const emergencyComplete = Boolean(me.emergency?.name && me.emergency?.phone)

  return (
    <div className="dr-scroll">
      <IdentityCard me={me} onChange={setMe} />
      <ProfileCompletion me={me} onOpen={setView} />

      <ProfileSection title="Documents & Compliance">
        <ProfileRow
          title="Driver's licence"
          detail={me.license?.expiry ? `Expires ${fmtDate(me.license.expiry)}` : "No expiry recorded"}
          badge={licenceState.label}
          badgeTone={licenceState.tone}
          onClick={() => setView("licence")}
        />
      </ProfileSection>

      <ProfileSection title="Account">
        <ProfileRow
          title="Personal information"
          detail={me.phone || "Add your mobile number"}
          onClick={() => setView("personal")}
        />
        <ProfileRow
          title="Emergency contact"
          detail={emergencyComplete ? `${me.emergency.name} · ${me.emergency.relation || me.emergency.phone}` : "Add contact details"}
          badge={emergencyComplete ? "Complete" : "Needs attention"}
          badgeTone={emergencyComplete ? "ok" : "warn"}
          onClick={() => setView("emergency")}
        />
        <ProfileRow
          title="Change PIN"
          detail="The PIN you sign in with"
          onClick={() => setView("pin")}
        />
        {/* Set by the office; a code goes here when this account signs in on a new phone. */}
        <ProfileRow
          title="Sign-in email"
          detail={me.email || "None on file. Ask your office to add one."}
          badge={me.email ? undefined : "Needs attention"}
          badgeTone="warn"
          chevron={false}
        />
      </ProfileSection>

      <ProfileSection title="Work Information">
        <ProfileRow
          title="Assigned vehicle"
          detail={vehicleSummary(currentTrip, tripsState)}
          onClick={() => setView("work")}
        />
        <ProfileRow
          title="Home branch"
          detail={me.branch || "Not assigned"}
          onClick={() => setView("work")}
        />
        <ProfileRow
          title="Availability"
          detail="Your current dispatch status"
          badge={availabilityLabel(me.status)}
          badgeTone={me.status === "active" ? "ok" : me.status === "on_trip" ? "accent" : "neutral"}
          onClick={() => setView("work")}
        />
        <ProfileRow
          title="Trip history"
          detail={`${me.totals.trips.toLocaleString("en-PH")} completed run${me.totals.trips === 1 ? "" : "s"}`}
          onClick={onOpenHistory}
        />
      </ProfileSection>

      <section className="dr-profile-section" aria-labelledby="dr-profile-appearance">
        <h2 className="dr-profile-section-title" id="dr-profile-appearance">Appearance</h2>
        <ProfileThemeSwitch />
      </section>

      <ProfileSection title="Help">
        <ProfileRow
          title="Help & Support"
          detail="Report a problem, pause a delivery, FAQs"
          badge={supportUnread > 0 ? `${supportUnread} new` : undefined}
          badgeTone="accent"
          onClick={() => setView("support")}
        />
      </ProfileSection>

      <ProfileSection title="Other">
        <ProfileRow title="Sign out" detail="Sign out of this device" danger onClick={onSignOut} chevron={false} />
      </ProfileSection>

      <p className="dr-foot">
        {me.company}
        {me.branch ? ` · ${me.branch}` : ""}
      </p>
    </div>
  )
}

function ProfileLoading() {
  return (
    <div className="dr-scroll">
      <DriverLoader variant="screen" label="Loading your profile…" />
    </div>
  )
}

function ProfileLoadError({ message, onRetry }) {
  return (
    <div className="dr-scroll">
      <section className="dr-profile-load-error" role="alert">
        <h2>Couldn&rsquo;t load your profile</h2>
        <p>{message || "Check your connection and try again."}</p>
        <button type="button" className="dr-btn" onClick={onRetry}>Try again</button>
      </section>
    </div>
  )
}

function ProfileDetail({ title, subtitle, onBack, children }) {
  return (
    <div className="dr-scroll dr-profile-detail">
      <header className="dr-profile-detail-head">
        <button type="button" className="dr-back" aria-label="Back to profile" onClick={onBack}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <span className="dr-profile-detail-copy">
          <span className="dr-profile-detail-title">{title}</span>
          <span className="dr-profile-detail-sub">{subtitle}</span>
        </span>
      </header>
      {children}
    </div>
  )
}

function ProfileSection({ title, children }) {
  return (
    <section className="dr-profile-section">
      <h2 className="dr-profile-section-title">{title}</h2>
      <div className="dr-profile-list dr-profile-box">{children}</div>
    </section>
  )
}

// Profile's older tone names, in the shared Badge's vocabulary.
const BADGE_TONE = { warn: "wait", accent: "info", ok: "ok", danger: "danger", neutral: "neutral" }

function ProfileRow({ title, detail, badge, badgeTone = "neutral", danger = false, chevron = true, onClick }) {
  const enabled = typeof onClick === "function"
  const accessibleLabel = [title, detail, badge].filter(Boolean).join(", ")
  return (
    <button
      type="button"
      className={`dr-profile-row${danger ? " danger" : ""}`}
      aria-label={accessibleLabel}
      onClick={enabled ? () => { tap("light"); onClick() } : undefined}
      disabled={!enabled}
    >
      <span className="dr-profile-row-copy">
        <span className="dr-profile-row-title">{title}</span>
        {detail && <span className="dr-profile-row-detail">{detail}</span>}
      </span>
      <span className="dr-profile-row-end">
        {badge && <Badge tone={BADGE_TONE[badgeTone] || "neutral"}>{badge}</Badge>}
        {chevron && enabled && <Chevron />}
      </span>
    </button>
  )
}

function profileRequirements(me) {
  return [
    { complete: Boolean(me.phone), label: "Add your mobile number", action: "Add now", view: "personal" },
    { complete: Boolean(me.emergency?.name && me.emergency?.phone), label: "Add an emergency contact", action: "Add now", view: "emergency" },
    { complete: Boolean(me.hasPhoto), label: "Add a profile picture above" },
  ]
}

function ProfileCompletion({ me, onOpen }) {
  const requirements = profileRequirements(me)
  const complete = requirements.filter((item) => item.complete).length
  const percentage = Math.round((complete / requirements.length) * 100)
  const missing = requirements.length - complete
  const next = requirements.find((item) => !item.complete)

  return (
    <section className="dr-profile-progress dr-profile-box" aria-label="Profile completion" data-complete={missing ? "no" : "yes"}>
      <div className="dr-profile-progress-head">
        <span className="dr-profile-progress-title">Profile completion</span>
        <span className="dr-profile-progress-value">{percentage}%</span>
      </div>
      <div
        className="dr-profile-progress-track"
        role="progressbar"
        aria-label="Profile completion"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={percentage}
        aria-valuetext={`${complete} of ${requirements.length} profile items complete`}
      >
        <span style={{ width: `${percentage}%` }} />
      </div>
      <div className="dr-profile-progress-bottom">
        <p className="dr-profile-progress-note">
          {missing ? `Next: ${next.label}.` : "Your profile is up to date."}
        </p>
        {next?.view && (
          <button type="button" onClick={() => { tap("light"); onOpen(next.view) }}>
            {next.action}
          </button>
        )}
      </div>
    </section>
  )
}

function licenceRowState(licence) {
  if (!licence?.no || !licence?.expiry) return { tone: "warn", label: "Not on file" }
  const { tone, say } = expiryTone(licence.daysLeft)
  if (tone === "danger") return { tone: "danger", label: say }
  if (tone === "warn") return { tone: "warn", label: say }
  return { tone: "ok", label: "Valid" }
}

function availabilityLabel(status) {
  if (status === "active") return "Available"
  if (status === "on_trip") return "On trip"
  if (status === "inactive") return "Inactive"
  return String(status || "Not recorded").replace(/_/g, " ")
}

function vehicleSummary(trip, state = "ready") {
  if (state === "loading") return "Checking current assignment…"
  if (state === "error") return "Assignment temporarily unavailable"
  if (!trip?.vehicle) return "No current vehicle assigned"
  return trip.vehicleType ? `${trip.vehicle} · ${trip.vehicleType}` : trip.vehicle
}

/* ---------------------------------------------------------------- */
/* Identity                                                         */
/* ---------------------------------------------------------------- */

const glyph = {
  width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
  strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true,
}
const CameraGlyph = ({ size = 20 }) => (
  <svg {...glyph} width={size} height={size}>
    <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
    <circle cx="12" cy="13" r="3.5" />
  </svg>
)
const GalleryGlyph = () => (
  <svg {...glyph}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="m21 16-5-5-9 9" />
  </svg>
)
const ChevGlyph = () => <svg {...glyph} width="16" height="16" className="dr-photo-chev"><path d="m9 18 6-6-6-6" /></svg>

function IdentityCard({ me, onChange }) {
  const [src, setSrc] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState("")
  const [editing, setEditing] = useState(false)

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

  async function upload(chosen) {
    setBusy(true)
    setErr("")
    try {
      const updated = await driverUploadPhoto(chosen)
      notifySuccess()
      onChange(updated)
      setEditing(false)
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
      setEditing(false)
    } catch (ex) {
      setErr(ex.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="dr-me-card dr-profile-box">
      <div className="dr-me-top">
        {/* The avatar itself opens the photo options: no badge on its corner. */}
        <button
          type="button"
          className="dr-me-avatar dr-me-avatar-btn"
          aria-label={me.hasPhoto ? "Edit picture" : "Add picture"}
          aria-expanded={editing}
          aria-controls="dr-profile-photo-options"
          disabled={busy}
          onClick={() => { tap("light"); setEditing((open) => !open) }}
        >
          <span className="dr-me-face">
            {src ? (
              <img src={src} alt="" />
            ) : (
              <span className="dr-me-initials">{initials(me.name) || "—"}</span>
            )}
            {busy && <span className="dr-me-busy" aria-hidden="true" />}
          </span>
        </button>

        {editing && (
          <div className="dr-photo-menu" id="dr-profile-photo-options">
            {/* Camera and gallery remain separate because Android does not
                reliably offer both from a single file input. */}
            <PhotoPick
              busy={busy}
              onFile={upload}
              facing="user"
              takeLabel={<><span className="dr-photo-ico"><CameraGlyph /></span><span className="dr-photo-label">{me.hasPhoto ? "Take a new photo" : "Take photo"}</span><ChevGlyph /></>}
              pickLabel={<><span className="dr-photo-ico"><GalleryGlyph /></span><span className="dr-photo-label">From gallery</span><ChevGlyph /></>}
              className="dr-photo-option"
            />
            {me.hasPhoto && (
              <button type="button" className="dr-photo-option danger" disabled={busy} onClick={drop}>
                Remove picture
              </button>
            )}
          </div>
        )}

        <span className="dr-me-who">
          <span className="dr-me-name" title={me.name} data-len={(me.name || "").length > 26 ? "xl" : (me.name || "").length > 20 ? "long" : undefined}>{me.name}</span>
          <span className="dr-me-no">
            <span className="dr-me-id-label">ID</span>
            <span>{me.employeeNo || "Not assigned"}</span>
          </span>
          <Badge tone={me.status === "active" ? "ok" : me.status === "on_trip" ? "info" : "neutral"}>{availabilityLabel(me.status)}</Badge>
        </span>
      </div>

      {err && <div className="dr-err tight">{err}</div>}
    </section>
  )
}

/* ---------------------------------------------------------------- */
/* Licence                                                          */
/* ---------------------------------------------------------------- */

/*
 * How the expiry reads is in licenceExpiry.js, shared with the Home notice and
 * the bell. The thresholds are the ones that matter operationally rather than
 * round numbers: an expired licence means the driver cannot lawfully be
 * dispatched today, and 60 days is roughly how long an LTO renewal takes to come
 * back if it goes wrong, so that is when it stops being paperwork and starts
 * being a problem.
 */

function LicenceCard({ licence }) {
  const { tone, say } = expiryTone(licence.daysLeft)
  const state = licenceState(licence)
  const [src, setSrc] = useState(null)
  // The photo sits behind auth, so it is fetched as a blob and revoked on the
  // way out rather than pointed at with an <img src>, which would arrive
  // unauthenticated. photoUpdatedAt changes when the office replaces it, which
  // is what makes the new photo load instead of the old one.
  useEffect(() => {
    let dead = false
    let url = null
    if (!licence.hasPhoto) { setSrc(null); return undefined }
    driverBlobUrl("/me/license-photo").then((u) => {
      if (dead) { if (u) URL.revokeObjectURL(u); return }
      url = u
      setSrc(u)
    })
    return () => {
      dead = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [licence.hasPhoto, licence.photoUpdatedAt])

  return (
    <section className="dr-lic dr-profile-box" data-tone={tone}>
      <div className="dr-lic-head">
        <span className="dr-lic-label">Driver&rsquo;s licence</span>
        {licence.type && <span className="dr-lic-type">{licence.type}</span>}
      </div>

      <div className="dr-lic-no">{licence.no || "Not on file"}</div>

      <div className="dr-lic-foot">
        <span className="dr-lic-exp">
          <span className="dr-lic-exp-label">Expires</span>
          <span className="dr-lic-exp-date">{fmtDate(licence.expiry)}</span>
        </span>
        <span className="dr-lic-flag">{say}</span>
      </div>

      {/* The card as the office has it on file. View only: tap to enlarge. */}
      <div className="dr-lic-photo-row">
        {src ? (
          <a className="dr-lic-photo-link" href={src} target="_blank" rel="noreferrer">
            <img className="dr-lic-photo" src={src} alt="Your licence, as your office has it on file" />
          </a>
        ) : (
          <span className="dr-lic-photo-empty">
            {licence.hasPhoto ? <DriverLoader variant="inline" label="Loading licence photo…" /> : "No photo on file"}
          </span>
        )}
      </div>

      <p className="dr-lic-note">
        {state === "expired"
          ? "Your licence has expired. Give your renewed licence to your office; you can't be assigned trips until they record it."
          : state === "expiring"
            ? "Already renewed? Give the new licence to your office to update it here."
            : "Your licence details are kept by your office. Contact dispatch if anything here is wrong."}
      </p>
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

function WorkInformation({ me, currentTrip, tripsState }) {
  return (
    <>
      <section className="dr-profile-facts dr-profile-box" aria-label="Work record">
        <div className="dr-profile-fact">
          <span>Assigned vehicle</span>
          <strong>
            {tripsState === "ready" && currentTrip?.vehicle
              ? currentTrip.vehicle
              : vehicleSummary(currentTrip, tripsState)}
          </strong>
          {currentTrip?.vehicleType && <small>{currentTrip.vehicleType}</small>}
        </div>
        <div className="dr-profile-fact">
          <span>Company</span>
          <strong>{me.company || "Not recorded"}</strong>
        </div>
        <div className="dr-profile-fact">
          <span>Home branch</span>
          <strong>{me.branch || "Not assigned"}</strong>
          {me.branchCode && <small>{me.branchCode}</small>}
        </div>
        <div className="dr-profile-fact">
          <span>Availability</span>
          <strong className="dr-profile-status-value" data-status={me.status}>{availabilityLabel(me.status)}</strong>
        </div>
      </section>

      <Totals totals={me.totals} />
    </>
  )
}

/* ---------------------------------------------------------------- */
/* What the driver may change                                       */
/* ---------------------------------------------------------------- */

function ContactForm({ me, onSaved, section }) {
  const [form, setForm] = useState({
    phone: me.phone || "",
    emergencyName: me.emergency.name || "",
    emergencyPhone: me.emergency.phone || "",
    emergencyRelation: me.emergency.relation || "",
  })
  const [savedForm, setSavedForm] = useState(form)
  const [state, setState] = useState("idle") // idle | saving | saved
  const [err, setErr] = useState("")
  const relevantFields = section === "personal"
    ? ["phone"]
    : ["emergencyName", "emergencyPhone", "emergencyRelation"]
  const dirty = relevantFields.some((field) => form[field] !== savedForm[field])

  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }))
    setState("idle")
  }

  async function save(e) {
    e.preventDefault()
    setState("saving")
    setErr("")
    try {
      const update = section === "personal"
        ? { phone: form.phone }
        : {
            emergencyName: form.emergencyName,
            emergencyPhone: form.emergencyPhone,
            emergencyRelation: form.emergencyRelation,
          }
      const updated = await driverUpdateMe(update)
      onSaved(updated)
      setSavedForm({ ...form })
      notifySuccess()
      setState("saved")
    } catch (ex) {
      setErr(ex.message)
      setState("idle")
    }
  }

  return (
    <form className="dr-form" onSubmit={save}>
      {section === "personal" ? (
        <>
          <section className="dr-profile-facts dr-profile-box" aria-label="Driver identity">
            <div className="dr-profile-fact">
              <span>Full name</span>
              <strong>{me.name}</strong>
            </div>
            <div className="dr-profile-fact">
              <span>Driver ID</span>
              <strong>{me.employeeNo || "Not assigned"}</strong>
            </div>
            {/* Kept by the office, like the name: where sign-in codes go. */}
            <div className="dr-profile-fact">
              <span>Sign-in email</span>
              <strong>{me.email || "None on file"}</strong>
            </div>
          </section>
          <p className="dr-hint" style={{ margin: "-4px 4px 14px" }}>
            Your name, ID and email are kept by your office. Ask them if any of these is wrong.
          </p>

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
        </>
      ) : (
        <>
          <p className="dr-hint">
            Keep this current so the office knows who to call if you cannot answer your phone.
          </p>

          <label className="dr-field">
            <span className="dr-label">Name</span>
            <input
              className="dr-input"
              autoComplete="name"
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
                autoComplete="tel"
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
        </>
      )}

      {err && <div className="dr-err tight">{err}</div>}

      <span className="dr-sr-only" aria-live="polite">
        {state === "saved" ? "Changes saved." : ""}
      </span>

      <button className="dr-btn" type="submit" disabled={state === "saving" || !dirty}>
        {state === "saving" ? "Saving…" : state === "saved" ? "Saved" : "Save changes"}
      </button>
    </form>
  )
}
