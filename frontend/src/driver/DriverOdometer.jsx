import { useEffect, useRef, useState } from "react"
import { currentDriverId, driverOdometer } from "./driverApi"
import { DetailHead } from "./DriverListBits"
import PhotoPick from "./PhotoPick"
import { newClientRef } from "./supportKinds"
import { tap } from "./native"
import { rememberOdometer } from "./odometerLocal"

/* the same limits the server keeps (fleet/odometer.service.js) */
const MAX_TRIP_KM = 3000
const MAX_ODOMETER_KM = 9999999

const fmtKm = (n) => Number(n).toLocaleString("en-PH", { maximumFractionDigits: 1 })

/** The typed figure as kilometres to one decimal, or null when it is not a number. */
export function readKm(text) {
  const t = String(text ?? "").trim().replace(/,/g, "")
  if (!/^\d+(\.\d+)?$/.test(t)) return null
  const n = Math.round(Number(t) * 10) / 10
  return n <= MAX_ODOMETER_KM ? n : null
}

/**
 * What the dashboard says, before Start ("start") or before delivery ("end").
 *
 * Asked for once, right where it is needed: the button that sent the driver
 * here goes on by itself once the reading is saved — "Save and start trip",
 * "Save and continue" to the delivery. A photo of the dashboard is optional.
 * Out of signal the reading waits on the phone and is sent before the step it
 * belongs to.
 */
export default function DriverOdometer({ tripId, kind, startKm = null, lastKnownKm = null, onBack, onDone }) {
  const [text, setText] = useState("")
  const [photo, setPhoto] = useState(null) // { file, url }
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  // one reference for this reading, kept across retries, so it is recorded once
  const clientRef = useRef(newClientRef())
  useEffect(() => () => { if (photo?.url) URL.revokeObjectURL?.(photo.url) }, [photo])

  const isStart = kind === "start"

  function check(value) {
    if (value == null) return "Enter the reading in kilometres, numbers only."
    if (!isStart && startKm != null) {
      if (value < startKm) return `That is lower than the start reading (${fmtKm(startKm)} km). Check the dashboard.`
      if (value - startKm > MAX_TRIP_KM) return `That is more than ${fmtKm(MAX_TRIP_KM)} km since the start reading. Check the dashboard.`
    }
    return ""
  }

  async function submit(ev) {
    ev.preventDefault()
    const value = readKm(text)
    const problem = check(value)
    setError(problem)
    if (problem) return
    setBusy(true)
    try {
      await driverOdometer(tripId, { kind, valueKm: value, photo: photo?.file || null, clientRef: clientRef.current })
      rememberOdometer(currentDriverId(), tripId, kind, value)
      tap("light")
      onDone(value)
    } catch (e) {
      setError(e.message || "Could not save the reading.")
      setBusy(false)
    }
  }

  return (
    <form className="dr-scroll dr-claimform" onSubmit={submit} noValidate>
      <DetailHead
        title={isStart ? "Start odometer" : "End odometer"}
        sub={isStart ? "What the dashboard says before you set off" : "What the dashboard says now, at the drop-off"}
        onBack={onBack}
      />

      <fieldset className="dr-group" disabled={busy}>
        <legend className="dr-group-title">Reading</legend>
        <label className="dr-label" htmlFor="odo-value">Odometer (km) <em>*</em></label>
        <input
          id="odo-value"
          className="dr-field dr-odo-field"
          inputMode="decimal"
          autoComplete="off"
          placeholder="e.g. 120150"
          value={text}
          aria-invalid={Boolean(error)}
          onChange={(e) => setText(e.target.value)}
        />
        <p className="dr-hint">
          {!isStart && startKm != null
            ? `Start reading: ${fmtKm(startKm)} km.`
            : lastKnownKm
              ? `Last figure on record for this vehicle: ${fmtKm(lastKnownKm)} km.`
              : "Type the number exactly as the dashboard shows it."}
        </p>
        {error && <p className="dr-fielderr" role="alert">{error}</p>}
      </fieldset>

      <fieldset className="dr-group" disabled={busy}>
        <legend className="dr-group-title">Dashboard photo <span className="dr-opt">(optional)</span></legend>
        {photo ? (
          <div className="dr-pause-photos">
            <span className="dr-pause-thumb has-remove">
              {photo.url ? <img src={photo.url} alt="Dashboard" /> : <span>Photo</span>}
              <button type="button" className="dr-pause-remove" aria-label="Remove photo" onClick={() => setPhoto(null)}>×</button>
            </span>
          </div>
        ) : (
          <div className="dr-receipt-pick">
            <PhotoPick
              onFile={(file) => setPhoto({ file, url: typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : null })}
              facing="environment"
              takeLabel="Take photo"
              pickLabel="From gallery"
            />
          </div>
        )}
      </fieldset>

      <div className="dr-actionbar">
        <button type="submit" className="dr-btn" disabled={busy}>
          {busy ? "Saving…" : isStart ? "Save and start trip" : "Save and continue"}
        </button>
      </div>
    </form>
  )
}
