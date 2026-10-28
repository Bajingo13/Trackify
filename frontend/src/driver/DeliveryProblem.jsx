import { useEffect, useRef, useState } from "react"
import { currentDriverId, driverDeliveryReport } from "./driverApi"
import { DetailHead } from "./DriverListBits"
import PhotoPick from "./PhotoPick"
import { readPosition } from "./readPosition"
import { newClientRef } from "./supportKinds"
import { tap, notifySuccess } from "./native"
import { OUTCOMES, reasonsFor, rememberNotDelivered } from "./deliveryReport"

const MAX_PHOTOS = 8

/**
 * What went wrong at the drop-off.
 *
 *   not_delivered          the load was not handed over: refused, nobody
 *                          there, wrong address, something else. No delivery
 *                          is filed; the trip stays on the road and the office
 *                          decides what happens to the load.
 *   delivered_with_issue   the delivery was confirmed, but the load was short,
 *                          damaged or the wrong item. Opened right after the
 *                          POD, so the server has the delivery first.
 *
 * A reason, the driver's words, and photos (required where they are the
 * evidence: short and damaged). Works out of signal: it waits in the outbox,
 * and a "not delivered" is remembered on the phone so the trip screen says so
 * at once (deliveryReport.js).
 */
export default function DeliveryProblem({ tripId, ticketNo, outcome, onBack, onDone }) {
  const notDelivered = outcome === OUTCOMES.not_delivered
  const reasons = reasonsFor(outcome)
  const [reason, setReason] = useState("")
  const [note, setNote] = useState("")
  const [qtyExpected, setQtyExpected] = useState("")
  const [qtyDelivered, setQtyDelivered] = useState("")
  const [photos, setPhotos] = useState([]) // [{ file, url }]
  const [errors, setErrors] = useState({})
  const [serverErr, setServerErr] = useState("")
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(null) // { queued }
  // one reference for this report, kept across retries, so it is filed once
  const clientRef = useRef(newClientRef())

  const urls = useRef(new Set())
  useEffect(() => () => { urls.current.forEach((u) => URL.revokeObjectURL?.(u)) }, [])

  const spec = reasons.find((r) => r.value === reason) || null
  const isShort = reason === "short"
  const clearError = (key) => setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e))

  function addPhoto(file) {
    if (photos.length >= MAX_PHOTOS) return
    const url = typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : null
    if (url) urls.current.add(url)
    setPhotos((list) => [...list, { file, url }])
    clearError("photos")
  }
  function removePhoto(target) {
    if (target.url) { URL.revokeObjectURL?.(target.url); urls.current.delete(target.url) }
    setPhotos((list) => list.filter((p) => p !== target))
  }

  function validate() {
    const e = {}
    if (!spec) e.reason = notDelivered ? "Choose why it was not delivered." : "Choose what was wrong."
    if (note.trim().length < 3) e.note = "Say what happened, in a few words."
    if (isShort) {
      const expected = Number(qtyExpected)
      const delivered = Number(qtyDelivered)
      if (qtyExpected === "" || !Number.isFinite(expected) || expected <= 0) e.qty = "Enter how many were expected."
      else if (qtyDelivered === "" || !Number.isFinite(delivered) || delivered < 0) e.qty = "Enter how many were delivered."
      else if (delivered >= expected) e.qty = "A short delivery has fewer delivered than expected."
    }
    if (spec?.photo && photos.length === 0) e.photos = `${spec.label}: add a photo.`
    return e
  }

  async function submit(ev) {
    ev.preventDefault()
    const e = validate()
    setErrors(e)
    if (Object.keys(e).length) return
    setServerErr("")
    setBusy(true)
    try {
      const position = await readPosition()
      const out = await driverDeliveryReport(tripId, {
        outcome,
        reason,
        note: note.trim(),
        qtyExpected: isShort ? qtyExpected : null,
        qtyDelivered: isShort ? qtyDelivered : null,
        photos: photos.map((p) => p.file),
        clientRef: clientRef.current,
        lat: position?.lat,
        lng: position?.lng,
      })
      if (notDelivered) rememberNotDelivered(currentDriverId(), tripId, { reason })
      notifySuccess()
      setSent({ queued: Boolean(out?.queued) })
    } catch (err) {
      setServerErr(err.message || "Could not send the report.")
    } finally {
      setBusy(false)
    }
  }

  const title = notDelivered ? "Not delivered" : "Problem with the delivery"

  if (sent) {
    return (
      <div className="dr-scroll">
        <DetailHead title={title} onBack={() => onDone(sent)} />
        <div className="dr-done" data-tone={notDelivered ? "warn" : "ok"}>
          <h2 className="dr-done-title">{notDelivered ? "Reported: not delivered" : "Problem reported"}</h2>
          <p className="dr-done-text">
            {notDelivered
              ? "Keep the load on the truck. The office has been told and will say what happens next: try again, or bring it back."
              : "The office has been told. Your delivery is recorded."}
          </p>
          {sent.queued && <p className="dr-done-text">Saved on this phone. It is sent when you are back online.</p>}
        </div>
        <button type="button" className="dr-btn" style={{ marginTop: 16 }} onClick={() => onDone(sent)}>Back to the trip</button>
      </div>
    )
  }

  return (
    <form className="dr-scroll dr-claimform" onSubmit={submit} noValidate>
      <DetailHead
        title={title}
        sub={ticketNo || (notDelivered ? "The load was not handed over" : "The delivery is recorded")}
        onBack={onBack}
      />

      {notDelivered && (
        <div className="dr-insp-warning" role="note">
          <strong>No delivery will be recorded</strong>
          <span>Keep the load on the truck. The office decides what happens next. If the receiver takes it after all, use I&rsquo;ve delivered as usual.</span>
        </div>
      )}

      <fieldset className="dr-group" disabled={busy}>
        <legend className="dr-group-title">{notDelivered ? "Why was it not delivered?" : "What was wrong?"} <em>*</em></legend>
        {/* the same choice cards as the pause form */}
        <div className="dr-pause-reasons" role="radiogroup" aria-label={notDelivered ? "Why it was not delivered" : "What was wrong"}>
          {reasons.map((r) => (
            <button
              key={r.value}
              type="button"
              role="radio"
              aria-checked={reason === r.value}
              className="dr-pause-reason-opt"
              data-on={reason === r.value ? "yes" : "no"}
              onClick={() => { tap("light"); setReason(r.value); clearError("reason"); clearError("photos") }}
            >
              <span className="dr-pause-reason-title">{r.label}</span>
              <span className="dr-pause-reason-hint">{r.hint}</span>
            </button>
          ))}
        </div>
        {errors.reason && <p className="dr-fielderr" role="alert">{errors.reason}</p>}

        {isShort && (
          <div className="dr-report-qty">
            <div>
              <label className="dr-label" htmlFor="report-expected">Expected <em>*</em></label>
              <input id="report-expected" className="dr-field" inputMode="decimal" value={qtyExpected}
                onChange={(e) => { setQtyExpected(e.target.value); clearError("qty") }} placeholder="e.g. 10" />
            </div>
            <div>
              <label className="dr-label" htmlFor="report-delivered">Delivered <em>*</em></label>
              <input id="report-delivered" className="dr-field" inputMode="decimal" value={qtyDelivered}
                onChange={(e) => { setQtyDelivered(e.target.value); clearError("qty") }} placeholder="e.g. 8" />
            </div>
          </div>
        )}
        {errors.qty && <p className="dr-fielderr" role="alert">{errors.qty}</p>}

        <label className="dr-label" htmlFor="report-note">What happened <em>*</em></label>
        <textarea
          id="report-note"
          className="dr-field"
          rows={3}
          maxLength={1000}
          placeholder={notDelivered ? "Who you spoke to, what they said, how long you waited." : "What was short or damaged, and how it was noted."}
          value={note}
          onChange={(e) => { setNote(e.target.value); if (e.target.value.trim().length >= 3) clearError("note") }}
        />
        {errors.note && <p className="dr-fielderr" role="alert">{errors.note}</p>}
      </fieldset>

      <fieldset className="dr-group" disabled={busy}>
        <legend className="dr-group-title">
          Photos {spec?.photo ? <em>*</em> : <span className="dr-opt">(optional)</span>}
        </legend>
        {photos.length > 0 && (
          <div className="dr-pause-photos" aria-label="Photos for the report">
            {photos.map((p, i) => (
              <span key={p.url || i} className="dr-pause-thumb has-remove">
                {p.url ? <img src={p.url} alt={`Report photo ${i + 1}`} /> : <span>Photo {i + 1}</span>}
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
        <button type="submit" className="dr-btn" disabled={busy}>{busy ? "Sending…" : "Send to the office"}</button>
      </div>
    </form>
  )
}
