import { useEffect, useRef, useState } from "react"
import { driverPauseCreate, driverTrips } from "./driverApi"
import { DetailHead } from "./DriverListBits"
import PhotoPick from "./PhotoPick"
import { readPosition } from "./readPosition"
import { PAUSE_REASONS, newClientRef } from "./supportKinds"
import { tap } from "./native"
import { NeedsInternet } from "./DriverBits"
import { useNetStatus } from "./netStatus"

/**
 * Ask the office to pause a delivery.
 *
 * For a real interruption — a breakdown, an accident, a flooded road — and
 * built for the person it happens to: a few taps, large targets, nothing that
 * can be skipped except the photograph when someone is hurt. What the office
 * needs in order to say yes without a phone call is here: what happened, in the
 * driver's words, and a picture of it.
 *
 * The request is stamped with the moment it was sent and with where the truck
 * was. Out of signal it is parked on the phone with its photographs and sent
 * later, and the confirmation says so in so many words: a driver told "sent"
 * for something still on the phone would wait for a reply that cannot come.
 */

const MAX_PHOTOS = 5
const MIN_WORDS = 10

export default function PauseForm({ tripId: preset = null, reason: presetReason = "", onBack, onDone, onOpen, onGeneral }) {
  const [trips, setTrips] = useState(null)
  const [tripId, setTripId] = useState(preset ? String(preset) : "")
  const [reason, setReason] = useState(presetReason)
  const [description, setDescription] = useState("")
  const [photos, setPhotos] = useState([]) // [{ file, url }]
  const [errors, setErrors] = useState({})
  const [serverErr, setServerErr] = useState("")
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(null) // { pause }
  const offline = useNetStatus() === "offline"
  // one reference per form, kept across retries, so a send lost on the way back
  // is filed once however many times the button is pressed
  const clientRef = useRef(newClientRef())

  useEffect(() => {
    let live = true
    driverTrips()
      .then((rows) => {
        if (!live) return
        const onTheRoad = rows.filter((t) => t.status === "in_transit")
        setTrips(onTheRoad)
        if (!preset && onTheRoad.length === 1) setTripId(String(onTheRoad[0].id))
      })
      .catch(() => { if (live) setTrips([]) })
    return () => { live = false }
  }, [preset])

  // previews are blobs: made as photos are added, and let go of on the way out
  const urls = useRef(new Set())
  useEffect(() => () => { urls.current.forEach((u) => URL.revokeObjectURL?.(u)) }, [])

  function addPhoto(file) {
    if (photos.length >= MAX_PHOTOS) return
    const url = typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : null
    if (url) urls.current.add(url)
    setPhotos((list) => [...list, { file, url }])
  }
  function removePhoto(index) {
    setPhotos((list) => {
      const gone = list[index]
      if (gone?.url) { URL.revokeObjectURL?.(gone.url); urls.current.delete(gone.url) }
      return list.filter((_, i) => i !== index)
    })
  }

  const emergency = reason === "emergency"

  function validate() {
    const e = {}
    if (!tripId) e.trip = "Choose the delivery you are on."
    if (!reason) e.reason = "Choose what happened."
    if (description.trim().length < MIN_WORDS) e.description = "Describe what happened, in a sentence or two."
    if (!emergency && photos.length === 0) e.photos = "Add at least one photo so the office can see the problem."
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
      // where the truck is right now: the office judges a pause by where it is
      const position = await readPosition()
      const out = await driverPauseCreate(tripId, {
        reason,
        description: description.trim(),
        photos: photos.map((p) => p.file),
        lat: position?.lat,
        lng: position?.lng,
        clientRef: clientRef.current,
      })
      setSent({ pause: out?.data || null })
    } catch (e2) {
      setServerErr(e2.message || "Could not send that request.")
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <div className="dr-scroll">
        <DetailHead title="Pause request" onBack={onDone} />
        <div className="dr-done">
          <span className="dr-done-mark" aria-hidden="true">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 13 4 4L19 7" /></svg>
          </span>
          <h2 className="dr-done-title">Sent to the office</h2>
          <p className="dr-done-text">
            The office will review it. Your delivery is not paused until they approve it. You will see their answer here, and a dot shows on the help button.
          </p>
        </div>
        {sent.pause?.ticketId && (
          <button type="button" className="dr-btn" onClick={() => onOpen(sent.pause.ticketId)}>Follow this request</button>
        )}
        <button type="button" className={!sent.pause?.ticketId ? "dr-btn" : "dr-btn ghost"} style={{ marginTop: 10 }} onClick={onDone}>
          Back to Help &amp; Support
        </button>
      </div>
    )
  }

  const noDelivery = trips && trips.length === 0

  return (
    <form className="dr-scroll dr-claimform" onSubmit={submit} noValidate>
      <DetailHead title="Pause delivery" sub="Tell the office what is stopping you" onBack={onBack} />

      {noDelivery && (
        <div className="dr-empty">
          <div className="dr-empty-title">No delivery on the road</div>
          <div className="dr-empty-text">
            A pause is for a delivery you have started. For anything else, send the office a request.
          </div>
          <button type="button" className="dr-btn" style={{ marginTop: 12 }} onClick={() => onGeneral?.(emergency)}>
            Send a request instead
          </button>
        </div>
      )}

      {!noDelivery && (
        <>
          {trips && trips.length > 1 && (
            <fieldset className="dr-group" disabled={busy}>
              <legend className="dr-group-title">Which delivery? <em>*</em></legend>
              <div className="dr-chips" role="group" aria-label="Which delivery">
                {trips.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`dr-chip ${String(t.id) === tripId ? "on" : ""}`}
                    aria-pressed={String(t.id) === tripId}
                    onClick={() => setTripId(String(t.id))}
                  >
                    {t.ticketNo}
                  </button>
                ))}
              </div>
              {errors.trip && <p className="dr-fielderr" role="alert">{errors.trip}</p>}
            </fieldset>
          )}
          {trips && trips.length === 1 && (
            <p className="dr-pause-for">For run <strong>{trips[0].ticketNo}</strong></p>
          )}

          <fieldset className="dr-group" disabled={busy}>
            <legend className="dr-group-title">What happened? <em>*</em></legend>
            <div className="dr-pause-reasons" role="radiogroup" aria-label="What happened">
              {PAUSE_REASONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  role="radio"
                  aria-checked={reason === r.value}
                  className="dr-pause-reason-opt"
                  data-on={reason === r.value ? "yes" : "no"}
                  data-tone={r.value === "emergency" ? "danger" : undefined}
                  onClick={() => { tap("light"); setReason(r.value) }}
                >
                  <span className="dr-pause-reason-title">{r.label}</span>
                  <span className="dr-pause-reason-hint">{r.hint}</span>
                </button>
              ))}
            </div>
            {errors.reason && <p className="dr-fielderr" role="alert">{errors.reason}</p>}
          </fieldset>

          <fieldset className="dr-group" disabled={busy}>
            <legend className="dr-group-title">Details</legend>
            <label className="dr-label" htmlFor="pause-description">Describe the problem <em>*</em></label>
            <textarea
              id="pause-description"
              className="dr-field"
              rows={4}
              maxLength={2000}
              placeholder="Where you are, what happened, and how long you think it will take."
              value={description}
              aria-invalid={Boolean(errors.description)}
              onChange={(e) => setDescription(e.target.value)}
            />
            {errors.description && <p className="dr-fielderr" role="alert">{errors.description}</p>}
          </fieldset>

          <fieldset className="dr-group" disabled={busy}>
            <legend className="dr-group-title">
              Photos {emergency ? <span className="dr-opt">(optional in an emergency)</span> : <em>*</em>}
            </legend>
            {photos.length > 0 && (
              <div className="dr-pause-photos" aria-label="Photos to send">
                {photos.map((p, i) => (
                  <span key={p.url || i} className="dr-pause-thumb has-remove">
                    {p.url ? <img src={p.url} alt={`Photo ${i + 1}`} /> : <span>Photo {i + 1}</span>}
                    <button type="button" className="dr-pause-remove" aria-label={`Remove photo ${i + 1}`} onClick={() => removePhoto(i)}>×</button>
                  </span>
                ))}
              </div>
            )}
            <p className="dr-hint">
              {emergency
                ? "Only if it is safe to. Your safety comes first."
                : `Show the problem: the damage, the road, the place. Up to ${MAX_PHOTOS} photos.`}
            </p>
            {photos.length < MAX_PHOTOS && (
              <div className="dr-receipt-pick">
                <PhotoPick onFile={addPhoto} facing="environment" takeLabel={photos.length ? "Add another" : "Take photo"} pickLabel="From gallery" />
              </div>
            )}
            {errors.photos && <p className="dr-fielderr" role="alert">{errors.photos}</p>}
          </fieldset>

          <p className="dr-pause-footnote">
            This sends the time and where your truck is now. The office reviews it and replies here. Your delivery is not paused until they approve it.
          </p>

          {(serverErr || Object.keys(errors).length > 0) && (
            <div className="dr-formerr" role="alert">
              {serverErr || "Please fill in the highlighted parts before sending."}
            </div>
          )}

          <div className="dr-actionbar">
            <button type="submit" className="dr-btn" disabled={busy || offline || !trips}>
              {busy ? "Sending…" : "Send pause request"}
            </button>
            {offline && <NeedsInternet also="If this is an emergency, call the office.">Sending a pause request</NeedsInternet>}
          </div>
        </>
      )}
    </form>
  )
}
