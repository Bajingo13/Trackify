import { useEffect, useRef, useState } from "react"
import { currentDriverId, driverInspect } from "./driverApi"
import { DetailHead } from "./DriverListBits"
import PhotoPick from "./PhotoPick"
import { readPosition } from "./readPosition"
import { newClientRef } from "./supportKinds"
import { tap, notifySuccess } from "./native"
import { rememberInspection, resultOfAnswers } from "./inspectionLocal"

const MAX_PHOTOS = 8

/**
 * The pre-trip inspection, before Start.
 *
 * One answer per item: OK, Problem, or N/A — and N/A is not offered for the
 * critical items, because a truck whose brakes were not checked is not a truck
 * that passed. There is no "all OK" button on purpose: each item is looked at
 * and tapped. A problem needs a few words and a photo, which is what the Fleet
 * team decides from.
 *
 * Works out of signal: it is saved on the phone and sent ahead of the Start
 * that follows it. What the driver answered is remembered (inspectionLocal.js),
 * so a failed critical item holds the Start button at once, signal or not.
 */
export default function DriverInspection({ tripId, ticketNo, plateNo, checklist = [], onBack, onDone }) {
  const [answers, setAnswers] = useState({}) // key -> { response, note }
  const [photos, setPhotos] = useState([]) // [{ key, file, url }]
  const [confirmed, setConfirmed] = useState(false)
  const [errors, setErrors] = useState({})
  const [serverErr, setServerErr] = useState("")
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(null) // { result, queued }
  // one reference for this inspection, kept across retries, so it is filed once
  const clientRef = useRef(newClientRef())

  const urls = useRef(new Set())
  useEffect(() => () => { urls.current.forEach((u) => URL.revokeObjectURL?.(u)) }, [])

  const answer = (key, patch) => setAnswers((all) => ({ ...all, [key]: { ...all[key], ...patch } }))

  function addPhoto(key, file) {
    if (photos.length >= MAX_PHOTOS) return
    const url = typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : null
    if (url) urls.current.add(url)
    setPhotos((list) => [...list, { key, file, url }])
  }
  function removePhoto(target) {
    setPhotos((list) => {
      if (target.url) { URL.revokeObjectURL?.(target.url); urls.current.delete(target.url) }
      return list.filter((p) => p !== target)
    })
  }

  function validate() {
    const e = {}
    for (const item of checklist) {
      const a = answers[item.key]
      if (!a?.response) e[item.key] = "Check this item."
      else if (a.response === "problem") {
        if (String(a.note || "").trim().length < 3) e[item.key] = "Say what is wrong."
        else if (!photos.some((p) => p.key === item.key)) e[item.key] = "Add a photo of the problem."
      }
    }
    if (!confirmed) e.confirm = "Confirm that you checked the vehicle yourself."
    return e
  }

  async function submit(ev) {
    ev.preventDefault()
    setServerErr("")
    const found = validate()
    setErrors(found)
    if (Object.keys(found).length) return

    setBusy(true)
    try {
      const position = await readPosition()
      const list = checklist.map((item) => ({
        key: item.key,
        response: answers[item.key].response,
        ...(answers[item.key].response === "problem" ? { note: answers[item.key].note.trim() } : {}),
      }))
      const out = await driverInspect(tripId, {
        answers: list,
        photos,
        clientRef: clientRef.current,
        lat: position?.lat,
        lng: position?.lng,
      })
      const result = out?.data?.result || resultOfAnswers(answers, checklist)
      rememberInspection(currentDriverId(), tripId, { result, clientRef: clientRef.current })
      if (result === "pass") notifySuccess()
      setSent({ result, queued: Boolean(out?.queued) })
    } catch (e2) {
      setServerErr(e2.message || "Could not send the inspection.")
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    const problems = checklist.filter((c) => answers[c.key]?.response === "problem")
    const critical = problems.filter((c) => c.critical)
    const copy = sent.result === "fail_critical"
      ? {
        tone: "danger",
        title: "Do not drive this vehicle",
        text: `${critical.map((c) => c.label).join(", ")} failed the inspection. The Fleet team has been told. This trip can start once they approve departure.`,
      }
      : sent.result === "fail_noncritical"
        ? { tone: "warn", title: "Inspection sent", text: `The Fleet team has been told about: ${problems.map((c) => c.label).join(", ")}. You can start the trip.` }
        : { tone: "ok", title: "Inspection passed", text: "Everything checked out. You can start the trip." }
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

  return (
    <form className="dr-scroll dr-claimform" onSubmit={submit} noValidate>
      <DetailHead
        title="Pre-trip inspection"
        sub={[plateNo, ticketNo].filter(Boolean).join(" · ") || "Check the vehicle before you start"}
        onBack={onBack}
      />

      <p className="dr-hint dr-insp-intro">
        Walk around the vehicle and check each item. If brakes, tyres or lights have a problem, the trip cannot start until the Fleet team approves it.
      </p>

      {checklist.map((item) => {
        const a = answers[item.key] || {}
        const mine = photos.filter((p) => p.key === item.key)
        const choices = [
          { value: "ok", label: "OK" },
          { value: "problem", label: "Problem" },
          ...(item.critical ? [] : [{ value: "na", label: "N/A" }]),
        ]
        return (
          <fieldset key={item.key} className="dr-group dr-insp-item" disabled={busy} data-problem={a.response === "problem" ? "yes" : undefined}>
            <legend className="dr-group-title">
              {item.label}{item.critical && <span className="dr-insp-critical">Critical</span>}
            </legend>
            <p className="dr-hint">{item.hint}</p>
            <div className="dr-htabs dr-insp-pick" role="radiogroup" aria-label={item.label}>
              {choices.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  role="radio"
                  className="dr-htab"
                  aria-checked={a.response === c.value}
                  data-tone={c.value === "problem" ? "danger" : undefined}
                  onClick={() => { tap("light"); answer(item.key, { response: c.value }) }}
                >
                  {c.label}
                </button>
              ))}
            </div>

            {a.response === "problem" && (
              <>
                <label className="dr-label" htmlFor={`insp-${item.key}`}>What is wrong? <em>*</em></label>
                <textarea
                  id={`insp-${item.key}`}
                  className="dr-field"
                  rows={2}
                  maxLength={500}
                  value={a.note || ""}
                  onChange={(e) => answer(item.key, { note: e.target.value })}
                />
                {mine.length > 0 && (
                  <div className="dr-pause-photos" aria-label={`Photos of ${item.label}`}>
                    {mine.map((p, i) => (
                      <span key={p.url || i} className="dr-pause-thumb has-remove">
                        {p.url ? <img src={p.url} alt={`${item.label} photo ${i + 1}`} /> : <span>Photo {i + 1}</span>}
                        <button type="button" className="dr-pause-remove" aria-label={`Remove ${item.label} photo ${i + 1}`} onClick={() => removePhoto(p)}>×</button>
                      </span>
                    ))}
                  </div>
                )}
                {photos.length < MAX_PHOTOS && (
                  <div className="dr-receipt-pick">
                    <PhotoPick
                      onFile={(file) => addPhoto(item.key, file)}
                      facing="environment"
                      takeLabel={mine.length ? "Add another" : "Take photo"}
                      pickLabel="From gallery"
                    />
                  </div>
                )}
              </>
            )}
            {errors[item.key] && <p className="dr-fielderr" role="alert">{errors[item.key]}</p>}
          </fieldset>
        )
      })}

      <label className="dr-check dr-insp-confirm" data-on={confirmed ? "yes" : "no"}>
        <input type="checkbox" checked={confirmed} disabled={busy} onChange={(e) => setConfirmed(e.target.checked)} />
        <span className="dr-check-box" aria-hidden="true" />
        <span className="dr-check-text">
          <strong>I checked this vehicle myself, just now</strong>
          <span>Your name and the time go on the inspection.</span>
        </span>
      </label>
      {errors.confirm && <p className="dr-fielderr" role="alert">{errors.confirm}</p>}

      {(serverErr || Object.keys(errors).length > 0) && (
        <div className="dr-formerr" role="alert">
          {serverErr || "Please finish the highlighted items before sending."}
        </div>
      )}

      <div className="dr-actionbar">
        <button type="submit" className="dr-btn" disabled={busy}>
          {busy ? "Sending…" : "Send inspection"}
        </button>
      </div>
    </form>
  )
}
