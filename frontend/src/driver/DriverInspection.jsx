import { useEffect, useRef, useState } from "react"
import { currentDriverId, driverInspect } from "./driverApi"
import { DetailHead } from "./DriverListBits"
import PhotoPick from "./PhotoPick"
import { readPosition } from "./readPosition"
import { newClientRef } from "./supportKinds"
import { tap, notifySuccess } from "./native"
import { rememberInspection } from "./inspectionLocal"

const MAX_PHOTOS = 8

/**
 * The pre-trip inspection, before Start.
 *
 * Built for the trip where nothing is wrong, which is nearly every trip: a
 * reminder of what to look at, and one confirmation that the driver did and
 * the vehicle is fit to drive. No checklist to tick through — a list of boxes
 * is what gets ticked without looking.
 *
 * When something is wrong there is a second path, "Report a problem": the
 * area (brakes, tyres, lights, fluids — more than one if need be), what is
 * wrong in the driver's words, and a photo. A problem with brakes, tyres or
 * lights holds the trip until the Fleet team approves departure; anything
 * else is passed to them and the trip may start.
 *
 * On the wire this is the same inspection as before: every checklist item is
 * answered — "ok" for what the driver confirmed, "problem" for what they
 * reported — so the server, the Fleet page and the record are unchanged.
 *
 * Works out of signal: it is saved on the phone and sent ahead of the Start
 * that follows it, and what was filed is remembered (inspectionLocal.js) so a
 * reported brake problem holds the Start button at once, signal or not.
 */
export default function DriverInspection({ tripId, ticketNo, plateNo, checklist = [], onBack, onDone }) {
  const [mode, setMode] = useState("confirm") // "confirm" | "report"
  const [confirmed, setConfirmed] = useState(false)
  const [problems, setProblems] = useState([]) // checklist keys
  const [description, setDescription] = useState("")
  const [photos, setPhotos] = useState([]) // [{ file, url }]
  const [errors, setErrors] = useState({})
  const [serverErr, setServerErr] = useState("")
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(null) // { result, queued }
  // one reference for this inspection, kept across retries, so it is filed once
  const clientRef = useRef(newClientRef())

  const urls = useRef(new Set())
  useEffect(() => () => { urls.current.forEach((u) => URL.revokeObjectURL?.(u)) }, [])

  const reported = checklist.filter((c) => problems.includes(c.key))
  const holdsTrip = reported.some((c) => c.critical)

  function addPhoto(file) {
    if (photos.length >= MAX_PHOTOS) return
    const url = typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : null
    if (url) urls.current.add(url)
    setPhotos((list) => [...list, { file, url }])
    clearError("photos")
  }
  // a message goes once the driver has fixed what it was about
  const clearError = (key) => setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e))
  function removePhoto(target) {
    if (target.url) { URL.revokeObjectURL?.(target.url); urls.current.delete(target.url) }
    setPhotos((list) => list.filter((p) => p !== target))
  }
  const toggleProblem = (key) => {
    setProblems((list) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]))
    clearError("problems")
  }

  async function send(answers, attached) {
    setServerErr("")
    setBusy(true)
    try {
      const position = await readPosition()
      const out = await driverInspect(tripId, {
        answers,
        // one set of photos for the whole report, not tied to one item
        photos: attached.map((p) => ({ key: "", file: p.file })),
        clientRef: clientRef.current,
        lat: position?.lat,
        lng: position?.lng,
      })
      const result = out?.data?.result || (holdsTrip ? "fail_critical" : answers.some((a) => a.response === "problem") ? "fail_noncritical" : "pass")
      rememberInspection(currentDriverId(), tripId, { result, clientRef: clientRef.current })
      if (result === "pass") notifySuccess()
      setSent({ result, queued: Boolean(out?.queued) })
    } catch (e) {
      setServerErr(e.message || "Could not send the inspection.")
    } finally {
      setBusy(false)
    }
  }

  function confirmGood(ev) {
    ev.preventDefault()
    if (!confirmed) {
      setErrors({ confirm: "Tick the box to confirm you inspected the vehicle." })
      return
    }
    setErrors({})
    void send(checklist.map((c) => ({ key: c.key, response: "ok" })), [])
  }

  function sendReport(ev) {
    ev.preventDefault()
    const e = {}
    if (!problems.length) e.problems = "Choose what is wrong."
    if (description.trim().length < 3) e.description = "Say what is wrong."
    if (!photos.length) e.photos = "Add a photo of the problem."
    setErrors(e)
    if (Object.keys(e).length) return
    const note = description.trim()
    void send(
      checklist.map((c) => (problems.includes(c.key) ? { key: c.key, response: "problem", note } : { key: c.key, response: "ok" })),
      photos
    )
  }

  if (sent) {
    const criticalNames = reported.filter((c) => c.critical).map((c) => c.label).join(", ")
    const copy = sent.result === "fail_critical"
      ? {
        tone: "danger",
        title: "Do not drive this vehicle",
        text: `${criticalNames || "A critical item"} needs attention. The Fleet team has been told. This trip can start once they approve departure.`,
      }
      : sent.result === "fail_noncritical"
        ? { tone: "warn", title: "Problem reported", text: `The Fleet team has been told about: ${reported.map((c) => c.label).join(", ")}. You can start the trip.` }
        : { tone: "ok", title: "Inspection confirmed", text: "Thank you. You can start the trip." }
    return (
      <div className="dr-scroll">
        <DetailHead title="Pre-trip inspection" onBack={() => onDone(sent.result)} />
        <div className="dr-done" data-tone={copy.tone}>
          <h2 className="dr-done-title">{copy.title}</h2>
          <p className="dr-done-text">{copy.text}</p>
          {sent.queued && <p className="dr-done-text">Saved on this phone. It is sent when you are back online, before your trip starts.</p>}
        </div>
        <button type="button" className="dr-btn" style={{ marginTop: 16 }} onClick={() => onDone(sent.result)}>Back to the trip</button>
      </div>
    )
  }

  const reminder = (
    <div className="dr-insp-warning" role="note">
      <strong>Before you drive, check the vehicle</strong>
      <ul>
        {checklist.map((c) => (
          <li key={c.key}><span>{c.label}</span>{c.hint ? ` — ${c.hint}` : ""}</li>
        ))}
      </ul>
      <span>Do not drive a vehicle that is not safe. If something is wrong, report it below.</span>
    </div>
  )

  if (mode === "report") {
    return (
      <form className="dr-scroll dr-claimform" onSubmit={sendReport} noValidate>
        <DetailHead title="Report a problem" sub={[plateNo, ticketNo].filter(Boolean).join(" · ") || "Before the trip"} onBack={() => { setErrors({}); setMode("confirm") }} />

        <fieldset className="dr-group" disabled={busy}>
          <legend className="dr-group-title">What is wrong? <em>*</em></legend>
          <div className="dr-chips" role="group" aria-label="What is wrong">
            {checklist.map((c) => (
              <button
                key={c.key}
                type="button"
                className={`dr-chip ${problems.includes(c.key) ? "on" : ""}`}
                aria-pressed={problems.includes(c.key)}
                onClick={() => { tap("light"); toggleProblem(c.key) }}
              >
                {c.label}
              </button>
            ))}
          </div>
          {holdsTrip && (
            <p className="dr-hint dr-insp-holds">
              {reported.filter((c) => c.critical).map((c) => c.label).join(", ")}: the trip waits until the Fleet team approves departure.
            </p>
          )}
          {errors.problems && <p className="dr-fielderr" role="alert">{errors.problems}</p>}

          <label className="dr-label" htmlFor="insp-description">Describe the problem <em>*</em></label>
          <textarea
            id="insp-description"
            className="dr-field"
            rows={3}
            maxLength={500}
            placeholder="What you found, and where on the vehicle."
            value={description}
            onChange={(e) => { setDescription(e.target.value); if (e.target.value.trim().length >= 3) clearError("description") }}
          />
          {errors.description && <p className="dr-fielderr" role="alert">{errors.description}</p>}
        </fieldset>

        <fieldset className="dr-group" disabled={busy}>
          <legend className="dr-group-title">Photo <em>*</em></legend>
          {photos.length > 0 && (
            <div className="dr-pause-photos" aria-label="Photos of the problem">
              {photos.map((p, i) => (
                <span key={p.url || i} className="dr-pause-thumb has-remove">
                  {p.url ? <img src={p.url} alt={`Problem photo ${i + 1}`} /> : <span>Photo {i + 1}</span>}
                  <button type="button" className="dr-pause-remove" aria-label={`Remove photo ${i + 1}`} onClick={() => removePhoto(p)}>×</button>
                </span>
              ))}
            </div>
          )}
          {photos.length < MAX_PHOTOS && (
            <div className="dr-receipt-pick">
              <PhotoPick onFile={addPhoto} facing="environment" takeLabel={photos.length ? "Add another" : "Take photo"} pickLabel="From gallery" />
            </div>
          )}
          {errors.photos && <p className="dr-fielderr" role="alert">{errors.photos}</p>}
        </fieldset>

        {serverErr && <div className="dr-formerr" role="alert">{serverErr}</div>}

        <div className="dr-actionbar">
          <button type="submit" className="dr-btn" disabled={busy}>{busy ? "Sending…" : "Send to Fleet"}</button>
        </div>
      </form>
    )
  }

  return (
    <form className="dr-scroll dr-claimform" onSubmit={confirmGood} noValidate>
      <DetailHead
        title="Pre-trip inspection"
        sub={[plateNo, ticketNo].filter(Boolean).join(" · ") || "Check the vehicle before you start"}
        onBack={onBack}
      />

      {reminder}

      <label className="dr-check dr-insp-confirm" data-on={confirmed ? "yes" : "no"}>
        <input type="checkbox" checked={confirmed} disabled={busy} onChange={(e) => { setConfirmed(e.target.checked); setErrors({}) }} />
        <span className="dr-check-box" aria-hidden="true" />
        <span className="dr-check-text">
          <strong>I inspected this vehicle and it is in good condition</strong>
          <span>Your name and the time go on the inspection.</span>
        </span>
      </label>
      {errors.confirm && <p className="dr-fielderr" role="alert">{errors.confirm}</p>}

      {serverErr && <div className="dr-formerr" role="alert">{serverErr}</div>}

      <div className="dr-actionbar">
        <button type="submit" className="dr-btn" disabled={busy || !confirmed}>
          {busy ? "Sending…" : "Confirm and continue"}
        </button>
        <button type="button" className="dr-linkbtn dr-insp-report" disabled={busy} onClick={() => { tap("light"); setErrors({}); setMode("report") }}>
          Something wrong? Report a problem
        </button>
      </div>
    </form>
  )
}
