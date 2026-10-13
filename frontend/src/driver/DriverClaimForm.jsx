import { useEffect, useState } from "react"
import { driverSubmitExpense, driverTrips } from "./driverApi"
import PhotoPick from "./PhotoPick"
import { Badge, DetailHead, FactList } from "./DriverListBits"
import { splitPlace } from "./DriverBits"

/**
 * File an expense claim.
 *
 * The server takes a claim against one run, so the run is the one field here
 * that cannot be left out; only the runs it will accept are offered (released,
 * in transit, or delivered within the last few days). From a trip the run is
 * already known and is shown, not asked.
 *
 * Nothing posts to the books from here. A claim goes in as "waiting for review"
 * and only finance can approve it. Out of signal it is parked on the phone and
 * sent later, which the confirmation says in so many words — a driver who is told
 * "submitted" for something still sitting on the phone will not file it again.
 */

export const CATEGORIES = [
  { value: "fuel", label: "Fuel" },
  { value: "toll", label: "Toll" },
  { value: "parking", label: "Parking" },
  { value: "meals", label: "Meals" },
  { value: "lodging", label: "Lodging" },
  { value: "repair", label: "Repair" },
  { value: "misc", label: "Other" },
]

const FILEABLE = ["released", "in_transit", "delivered"]
const MAX_AMOUNT = 1_000_000

const peso = (n) => `₱${Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Today as the date input wants it, in the phone's own time zone. */
const today = () => {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const RUN_SAYS = {
  released: { label: "Released", tone: "wait" },
  in_transit: { label: "In transit", tone: "ok" },
  delivered: { label: "Delivered", tone: "neutral" },
}

/** One run to choose from: its number, where it goes, and where it has got to. */
function RunChoice({ run, selected, onPick, fixed = false }) {
  const says = RUN_SAYS[run.status]
  const from = run.origin ? splitPlace(run.origin).title : null
  const to = run.destination ? splitPlace(run.destination).title : null
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className="dr-run"
      disabled={fixed}
      onClick={onPick}
    >
      <span className="dr-run-dot" aria-hidden="true" />
      <span className="dr-run-main">
        <span className="dr-run-no">{run.ticketNo}</span>
        {(from || to) && <span className="dr-run-route">{from || "—"} <span aria-hidden="true">→</span> {to || "—"}</span>}
      </span>
      {says && <Badge tone={says.tone}>{says.label}</Badge>}
    </button>
  )
}

export default function DriverClaimForm({ fixedTrip = null, onBack, onDone }) {
  const [runs, setRuns] = useState(fixedTrip ? [fixedTrip] : null)
  const [runId, setRunId] = useState(fixedTrip ? String(fixedTrip.id) : "")
  const [category, setCategory] = useState("")
  const [amount, setAmount] = useState("")
  const [date, setDate] = useState(today())
  const [receiptNo, setReceiptNo] = useState("")
  const [note, setNote] = useState("")
  const [photo, setPhoto] = useState(null)
  const [preview, setPreview] = useState(null)

  const [errors, setErrors] = useState({})
  const [serverErr, setServerErr] = useState("")
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(null) // { queued }

  useEffect(() => {
    if (fixedTrip) return undefined
    let live = true
    driverTrips()
      .then((rows) => {
        if (!live) return
        const ok = rows.filter((t) => FILEABLE.includes(t.status))
        setRuns(ok)
        if (ok.length === 1) setRunId(String(ok[0].id))
      })
      .catch(() => { if (live) setRuns([]) })
    return () => { live = false }
  }, [fixedTrip])

  useEffect(() => {
    if (!photo || !String(photo.type).startsWith("image/") || typeof URL.createObjectURL !== "function") {
      setPreview(null)
      return undefined
    }
    const made = URL.createObjectURL(photo)
    setPreview(made)
    return () => URL.revokeObjectURL(made)
  }, [photo])

  const run = runs?.find((r) => String(r.id) === runId)

  function validate() {
    const e = {}
    if (!runId) e.run = "Choose the run this expense belongs to."
    if (!category) e.category = "Choose what the expense was for."
    const value = Number(amount)
    if (amount === "" || !Number.isFinite(value) || value <= 0) e.amount = "Enter how much you spent."
    else if (value > MAX_AMOUNT) e.amount = "That amount looks wrong. Check it and try again."
    if (!date) e.date = "Choose the date of the expense."
    else if (date > today()) e.date = "The date cannot be in the future."
    return e
  }

  async function submit(ev) {
    ev.preventDefault()
    setServerErr("")
    const found = validate()
    setErrors(found)
    if (Object.keys(found).length) return

    const form = new FormData()
    form.set("category", category)
    form.set("amount", String(Number(amount)))
    form.set("expenseDate", date)
    if (receiptNo.trim()) form.set("receiptNo", receiptNo.trim())
    if (note.trim()) form.set("description", note.trim())
    if (photo) form.set("receipt", photo)

    setBusy(true)
    try {
      const out = await driverSubmitExpense(runId, form)
      setSent({ queued: Boolean(out?.queued) })
    } catch (e2) {
      setServerErr(e2.message || "Could not send that claim.")
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <div className="dr-scroll">
        <DetailHead title="Submit a claim" onBack={onDone} />
        <div className="dr-done">
          <span className="dr-done-mark" aria-hidden="true">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 13 4 4L19 7" /></svg>
          </span>
          <h2 className="dr-done-title">{sent.queued ? "Saved on this phone" : "Claim submitted"}</h2>
          <p className="dr-done-text">
            {sent.queued
              ? "There is no signal right now. It will be sent as soon as you are back online."
              : "Finance will review it. The result, and any remarks, will show under Claims."}
          </p>
        </div>
        <div className="dr-block">
          <div className="dr-block-body">
            <FactList
              rows={[
                { label: "Category", value: CATEGORIES.find((c) => c.value === category)?.label },
                { label: "Amount", value: peso(amount) },
                { label: "Date", value: new Date(`${date}T00:00:00`).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }) },
                { label: "Run", value: run?.ticketNo },
              ]}
            />
          </div>
        </div>
        <button type="button" className="dr-btn" onClick={onDone}>Back to claims</button>
      </div>
    )
  }

  const noRuns = runs && runs.length === 0

  return (
    <form className="dr-scroll dr-claimform" onSubmit={submit} noValidate>
      <DetailHead title="Submit a claim" sub="Attach the receipt so finance can check it" onBack={onBack} />

      <fieldset className="dr-group" disabled={busy}>
        <legend className="dr-group-title">Related run <em>*</em></legend>
        {fixedTrip ? (
          <div className="dr-runpick">
            <RunChoice run={{ ...fixedTrip, ticketNo: fixedTrip.ticketNo || "This run" }} selected fixed />
          </div>
        ) : runs == null ? (
          <div className="dr-loading">Loading your runs…</div>
        ) : noRuns ? (
          <div className="dr-note dr-note-quiet">
            <span>You can file a claim once a run has been released to you, and for three days after it is delivered.</span>
          </div>
        ) : (
          <>
            {/* Cards, not a dropdown: a run is recognised by its route and status,
                and the browser's own list shows neither and is hard to tap. */}
            <div className="dr-runpick" role="radiogroup" aria-label="Related run" aria-invalid={Boolean(errors.run)}>
              {runs.map((r) => (
                <RunChoice key={r.id} run={r} selected={String(r.id) === runId} onPick={() => setRunId(String(r.id))} />
              ))}
            </div>
            {errors.run && <p className="dr-fielderr" role="alert">{errors.run}</p>}
          </>
        )}
      </fieldset>

      <fieldset className="dr-group" disabled={busy || noRuns}>
        <legend className="dr-group-title">Expense</legend>

        <span className="dr-label">Category <em>*</em></span>
        <div className="dr-chips" role="group" aria-label="Expense category">
          {CATEGORIES.map((c) => (
            <button
              key={c.value}
              type="button"
              className={`dr-chip ${category === c.value ? "on" : ""}`}
              aria-pressed={category === c.value}
              onClick={() => setCategory(c.value)}
            >
              {c.label}
            </button>
          ))}
        </div>
        {errors.category && <p className="dr-fielderr" role="alert">{errors.category}</p>}

        <div className="dr-pair">
          <div>
            <label className="dr-label" htmlFor="claim-amount">Amount (₱) <em>*</em></label>
            <input
              id="claim-amount"
              className="dr-field"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={amount}
              aria-invalid={Boolean(errors.amount)}
              onChange={(e) => setAmount(e.target.value)}
            />
            {errors.amount && <p className="dr-fielderr" role="alert">{errors.amount}</p>}
          </div>
          <div>
            <label className="dr-label" htmlFor="claim-date">Date <em>*</em></label>
            <input
              id="claim-date"
              className="dr-field"
              type="date"
              max={today()}
              value={date}
              aria-invalid={Boolean(errors.date)}
              onChange={(e) => setDate(e.target.value)}
            />
            {errors.date && <p className="dr-fielderr" role="alert">{errors.date}</p>}
          </div>
        </div>
      </fieldset>

      <fieldset className="dr-group" disabled={busy || noRuns}>
        <legend className="dr-group-title">Receipt</legend>

        <div className="dr-receipt" data-has={photo ? "yes" : "no"}>
          {photo ? (
            <div className="dr-receipt-file">
              {preview ? <img src={preview} alt="Receipt to attach" /> : <span className="dr-receipt-pdf">PDF</span>}
              <span className="dr-receipt-name">{photo.name || "Receipt"}</span>
              <button type="button" className="dr-find-clear" onClick={() => setPhoto(null)}>Remove</button>
            </div>
          ) : (
            <p className="dr-receipt-hint">Finance checks your claim against a photo of the receipt.</p>
          )}
          {/* A receipt is usually photographed at the pump before this form is
              opened, so the gallery matters as much as the camera. */}
          <div className="dr-receipt-pick">
            <PhotoPick
              onFile={setPhoto}
              facing="environment"
              accept="image/*,application/pdf"
              takeLabel={photo ? "Retake" : "Take photo"}
              pickLabel="From gallery"
            />
          </div>
        </div>

        <label className="dr-label" htmlFor="claim-or">Receipt / OR number <span className="dr-opt">(optional)</span></label>
        <input
          id="claim-or"
          className="dr-field"
          value={receiptNo}
          maxLength={100}
          placeholder="e.g. OR-12345"
          onChange={(e) => setReceiptNo(e.target.value)}
        />
      </fieldset>

      <fieldset className="dr-group" disabled={busy || noRuns}>
        <legend className="dr-group-title">Notes</legend>
        <label className="dr-label" htmlFor="claim-note">Anything finance should know <span className="dr-opt">(optional)</span></label>
        <textarea
          id="claim-note"
          className="dr-field"
          rows={3}
          maxLength={255}
          placeholder="e.g. Diesel top-up, Digos"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </fieldset>

      {(serverErr || Object.keys(errors).length > 0) && (
        <div className="dr-formerr" role="alert">
          {serverErr || "Please fill in the highlighted fields before sending."}
        </div>
      )}

      <div className="dr-actionbar">
        <button type="submit" className="dr-btn" disabled={busy || noRuns}>
          {busy ? "Sending…" : "Submit claim"}
        </button>
      </div>
    </form>
  )
}
