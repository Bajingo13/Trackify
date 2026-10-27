import { useEffect, useRef, useState } from "react"
import { currentDriverId, driverScanReceipt, driverSubmitExpense, driverTrips } from "./driverApi"
import { clearDraft, useDraftSaver, useOpeningDraft } from "./formDraft"
import { newClientRef } from "./supportKinds"
import PhotoPick from "./PhotoPick"
import ChipRow from "./ChipRow"
import { Badge, DetailHead, FactList, tripBadge } from "./DriverListBits"
import { splitPlace } from "./DriverBits"
import { useNetStatus } from "./netStatus"
import DriverLoader from "./DriverLoader"

/**
 * File an expense claim.
 *
 * The server takes a claim against one run, so the run is the one field here
 * that cannot be left out; only the runs it will accept are offered (released,
 * in transit, or delivered within the last few days). From a trip the run is
 * already known and is shown, not asked.
 *
 * Two ways to fill it in. "Scan receipt" reads the photo on the server and
 * fills in the kind of expense, the amount, a description, the date and the OR
 * number. "Type it in" is the form on its own. Either way every value stays an
 * ordinary editable field. A reading is a suggestion the driver checks, and a
 * value that was hard to read says so. The photo travels with the claim the
 * same way in both, so a reading that fails or has no signal never costs the
 * driver the receipt.
 *
 * Nothing posts to the books from here. A claim goes in as "waiting for review"
 * and only finance can approve it. It needs the internet: offline the Submit
 * button is disabled and says why, and everything entered stays in the form.
 * It is never parked on the phone, so "submitted" always means finance has it.
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

const MODES = [
  { value: "scan", label: "Scan receipt" },
  { value: "manual", label: "Type it in" },
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

/** One run to choose from: its number, where it goes, and where it has got to. */
function RunChoice({ run, selected, onPick, fixed = false }) {
  // the same words and colours as Today's list and the run itself
  const says = run.status ? tripBadge(run.status, run.pauseStatus) : null
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

/** Marks a value the receipt reading put there, until the driver changes it. */
function FromReceipt({ level }) {
  if (!level) return null
  return level === "low"
    ? <span className="dr-autotag dr-autotag-check">Check this</span>
    : <span className="dr-autotag">From receipt</span>
}

export default function DriverClaimForm({ fixedTrip = null, onBack, onDone }) {
  // what was typed last time and not sent, if anything (formDraft.js); the
  // receipt photo is not part of it
  const driverId = currentDriverId()
  const draftKey = fixedTrip ? `claim:${fixedTrip.id}` : "claim"
  const draft = useOpeningDraft(driverId, draftKey)
  const was = draft?.values || {}
  const [restored, setRestored] = useState(Boolean(draft))

  const [runs, setRuns] = useState(fixedTrip ? [fixedTrip] : null)
  const [runId, setRunId] = useState(fixedTrip ? String(fixedTrip.id) : "")
  const [mode, setMode] = useState(MODES.some((m) => m.value === was.mode) ? was.mode : "scan")
  const [category, setCategory] = useState(was.category ?? "")
  const [amount, setAmount] = useState(was.amount ?? "")
  const [date, setDate] = useState(was.date && was.date <= today() ? was.date : today())
  const [receiptNo, setReceiptNo] = useState(was.receiptNo ?? "")
  const [note, setNote] = useState(was.note ?? "")
  const [photo, setPhoto] = useState(null)
  const [preview, setPreview] = useState(null)

  // { state: "idle" | "reading" | "done" | "error", message?, unsure? }
  const [scan, setScan] = useState({ state: "idle" })
  // field -> how sure the reading was, for each value it filled in that the
  // driver has not since changed. Mirrored in a ref so a reading that comes back
  // after a retake can clear what the previous one put there.
  const [auto, setAutoState] = useState({})
  const autoRef = useRef({})
  const setAuto = (next) => { autoRef.current = next; setAutoState(next) }
  // bumped by every new photo and by Remove, so a late answer about an old photo is ignored
  const scanSeq = useRef(0)

  const [errors, setErrors] = useState({})
  const [serverErr, setServerErr] = useState("")
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const offline = useNetStatus() === "offline"
  // one reference per form, kept across retries — and with the draft, so a claim
  // whose answer was lost on a weak signal is filed once however often it is sent
  const clientRef = useRef(draft?.clientRef || newClientRef())

  useDraftSaver({
    driverId,
    form: draftKey,
    values: { runId: fixedTrip ? undefined : runId, mode, category, amount, date, receiptNo, note },
    hasContent: (v) => Boolean(v.category || String(v.amount).trim() || v.receiptNo.trim() || v.note.trim()),
    clientRef: clientRef.current,
    enabled: !sent,
  })

  function discardDraft() {
    // a new reference too: the old one may already be on the office's side
    clientRef.current = newClientRef()
    setCategory("")
    setAmount("")
    setDate(today())
    setReceiptNo("")
    setNote("")
    setAuto({})
    setRestored(false)
    clearDraft(driverId, draftKey)
  }

  useEffect(() => {
    if (fixedTrip) return undefined
    let live = true
    driverTrips()
      .then((rows) => {
        if (!live) return
        const ok = rows.filter((t) => FILEABLE.includes(t.status))
        setRuns(ok)
        // the draft's run only if it can still take a claim
        if (was.runId && ok.some((t) => String(t.id) === was.runId)) setRunId(was.runId)
        else if (ok.length === 1) setRunId(String(ok[0].id))
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
  const reading = scan.state === "reading"

  /** A field the driver changes is theirs from then on. */
  const edited = (field, set) => (value) => {
    set(value)
    if (autoRef.current[field]) {
      const { [field]: _gone, ...rest } = autoRef.current
      setAuto(rest)
    }
  }

  function applyReading(out) {
    const f = out.fields || {}
    const sure = out.confidence || {}
    const before = autoRef.current
    const next = {}
    const take = (field, value, set, empty) => {
      if (value != null && value !== "") {
        set(value)
        next[field] = sure[field === "note" ? "description" : field] || "medium"
      } else if (before[field]) {
        // the previous photo's reading, which this one does not back up
        set(empty)
      }
    }
    take("category", CATEGORIES.some((c) => c.value === f.category) ? f.category : null, setCategory, "")
    take("amount", Number(f.amount) > 0 && Number(f.amount) <= MAX_AMOUNT ? String(Number(f.amount)) : null, setAmount, "")
    take("expenseDate", f.expenseDate && f.expenseDate <= today() ? f.expenseDate : null, setDate, today())
    take("receiptNo", f.receiptNo ? String(f.receiptNo).slice(0, 100) : null, setReceiptNo, "")
    take("note", f.description ? String(f.description).slice(0, 255) : null, setNote, "")
    setAuto(next)

    const filled = Object.keys(next).length
    if (!filled) {
      setScan({ state: "error", message: "Could not find the details on this receipt. Fill them in below." })
      return
    }
    // what the reading filled in no longer needs the "fill this in" message
    setErrors((e) => {
      const rest = { ...e }
      if (next.category) delete rest.category
      if (next.amount) delete rest.amount
      if (next.expenseDate) delete rest.date
      return rest
    })
    setScan({
      state: "done",
      unsure: Object.values(next).includes("low"),
      missing: !next.amount || !next.category,
    })
  }

  async function readReceipt(file) {
    const seq = ++scanSeq.current
    setScan({ state: "reading" })
    try {
      const out = await driverScanReceipt(file)
      if (seq !== scanSeq.current) return
      if (out?.status !== "read") {
        setScan({ state: "error", message: out?.message || "Could not read that receipt. Fill in the claim by hand." })
        return
      }
      applyReading(out)
    } catch (e) {
      if (seq !== scanSeq.current) return
      setScan({ state: "error", message: e.message || "Could not read that receipt. Fill in the claim by hand." })
    }
  }

  function attach(file) {
    setPhoto(file)
    if (mode === "scan") readReceipt(file)
    else {
      scanSeq.current += 1
      setScan({ state: "idle" })
    }
  }

  function removePhoto() {
    scanSeq.current += 1
    setPhoto(null)
    setScan({ state: "idle" })
  }

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
    if (reading) return
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
    form.set("clientRef", clientRef.current)

    setBusy(true)
    try {
      await driverSubmitExpense(runId, form)
      clearDraft(driverId, draftKey)
      setSent(true)
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
          <h2 className="dr-done-title">Claim submitted</h2>
          <p className="dr-done-text">
            Finance will review it. The result, and any remarks, will show under Claims.
          </p>
        </div>
        <div className="dr-block">
          <div className="dr-block-body">
            <FactList
              rows={[
                { label: "Category", value: CATEGORIES.find((c) => c.value === category)?.label },
                { label: "Amount", value: peso(amount) },
                { label: "Date", value: new Date(`${date}T00:00:00`).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }) },
                { label: "Description", value: note.trim() || null },
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
  const scanning = mode === "scan"

  const receiptBlock = (
    <fieldset className="dr-group" disabled={busy || noRuns}>
      <legend className="dr-group-title">Receipt</legend>

      <div className="dr-receipt" data-has={photo ? "yes" : "no"}>
        {photo ? (
          <div className="dr-receipt-file">
            {preview ? <img src={preview} alt="Receipt to attach" /> : <span className="dr-receipt-pdf">PDF</span>}
            <span className="dr-receipt-name">{photo.name || "Receipt"}</span>
            <button type="button" className="dr-find-clear" onClick={removePhoto}>Remove</button>
          </div>
        ) : (
          <p className="dr-receipt-hint">
            {scanning
              ? "Take a photo of the receipt. The amount, type of expense and description are filled in for you to check."
              : "Finance checks your claim against a photo of the receipt."}
          </p>
        )}
        {/* A receipt is usually photographed at the pump before this form is
            opened, so the gallery matters as much as the camera. */}
        <div className="dr-receipt-pick">
          <PhotoPick
            onFile={attach}
            busy={reading}
            facing="environment"
            accept={scanning ? "image/*" : "image/*,application/pdf"}
            takeLabel={photo ? "Retake" : "Take photo"}
            pickLabel="From gallery"
          />
        </div>

        {scanning && photo && scan.state === "idle" && (
          <button type="button" className="dr-btn-quiet" onClick={() => readReceipt(photo)}>
            Read this receipt
          </button>
        )}
        {reading && (
          <div className="dr-scanstate" role="status">
            <DriverLoader variant="inline" delay={0} label="Reading the receipt…" />
          </div>
        )}
        {scan.state === "done" && (
          <p className="dr-scanstate dr-scanstate-ok" role="status">
            Filled in from the receipt. Check each value before you send.
            {scan.unsure ? " Values marked “Check this” were hard to read." : ""}
            {scan.missing ? " Fill in anything it could not find." : ""}
          </p>
        )}
        {scan.state === "error" && (
          <p className="dr-scanstate dr-scanstate-warn" role="alert">{scan.message}</p>
        )}
      </div>

      <label className="dr-label" htmlFor="claim-or">
        Receipt / OR number <span className="dr-opt">(optional)</span> <FromReceipt level={auto.receiptNo} />
      </label>
      <input
        id="claim-or"
        className="dr-field"
        value={receiptNo}
        maxLength={100}
        placeholder="e.g. OR-12345"
        onChange={(e) => edited("receiptNo", setReceiptNo)(e.target.value)}
      />
    </fieldset>
  )

  return (
    <form className="dr-scroll dr-claimform" onSubmit={submit} noValidate>
      <DetailHead title="Submit a claim" sub="Scan the receipt, or type the details in" onBack={onBack} />

      {restored && (
        <div className="dr-note dr-draft-note" role="note">
          <span>Your unsent claim is back, as you left it. It has not been sent. Add the receipt photo again.</span>
          <button type="button" className="dr-linkbtn" onClick={discardDraft}>Discard</button>
        </div>
      )}

      <fieldset className="dr-group" disabled={busy}>
        <legend className="dr-group-title">Related run <em>*</em></legend>
        {fixedTrip ? (
          <div className="dr-runpick">
            <RunChoice run={{ ...fixedTrip, ticketNo: fixedTrip.ticketNo || "This run" }} selected fixed />
          </div>
        ) : runs == null ? (
          <DriverLoader variant="inline" label="Loading your runs…" />
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

      {/* Switching keeps everything entered and the photo: the two are ways of
          filling in one form, not two forms. */}
      <div className="dr-htabs dr-claimmode" role="radiogroup" aria-label="How to fill in the claim">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            role="radio"
            className="dr-htab"
            aria-checked={mode === m.value}
            disabled={busy || noRuns}
            onClick={() => setMode(m.value)}
          >
            {m.label}
          </button>
        ))}
      </div>

      {scanning && receiptBlock}

      <fieldset className="dr-group" disabled={busy || noRuns}>
        <legend className="dr-group-title">Expense</legend>

        <span className="dr-label">Category <em>*</em> <FromReceipt level={auto.category} /></span>
        <ChipRow label="Expense category">
          {CATEGORIES.map((c) => (
            <button
              key={c.value}
              type="button"
              className={`dr-chip ${category === c.value ? "on" : ""}`}
              aria-pressed={category === c.value}
              onClick={() => edited("category", setCategory)(c.value)}
            >
              {c.label}
            </button>
          ))}
        </ChipRow>
        {errors.category && <p className="dr-fielderr" role="alert">{errors.category}</p>}

        <div className="dr-pair">
          <div>
            <label className="dr-label" htmlFor="claim-amount">Amount (₱) <em>*</em> <FromReceipt level={auto.amount} /></label>
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
              onChange={(e) => edited("amount", setAmount)(e.target.value)}
            />
            {errors.amount && <p className="dr-fielderr" role="alert">{errors.amount}</p>}
          </div>
          <div>
            <label className="dr-label" htmlFor="claim-date">Date <em>*</em> <FromReceipt level={auto.expenseDate} /></label>
            <input
              id="claim-date"
              className="dr-field"
              type="date"
              max={today()}
              value={date}
              aria-invalid={Boolean(errors.date)}
              onChange={(e) => edited("expenseDate", setDate)(e.target.value)}
            />
            {errors.date && <p className="dr-fielderr" role="alert">{errors.date}</p>}
          </div>
        </div>

        <label className="dr-label" htmlFor="claim-note">
          Description <span className="dr-opt">(optional)</span> <FromReceipt level={auto.note} />
        </label>
        <textarea
          id="claim-note"
          className="dr-field"
          rows={3}
          maxLength={255}
          placeholder="e.g. Diesel top-up, Digos"
          value={note}
          onChange={(e) => edited("note", setNote)(e.target.value)}
        />
      </fieldset>

      {!scanning && receiptBlock}

      {(serverErr || Object.keys(errors).length > 0) && (
        <div className="dr-formerr" role="alert">
          {serverErr || "Please fill in the highlighted fields before sending."}
        </div>
      )}

      <div className="dr-actionbar">
        <button type="submit" className="dr-btn" disabled={busy || offline || noRuns || reading}>
          {busy ? "Sending…" : reading ? "Reading receipt…" : "Submit claim"}
        </button>
      </div>
    </form>
  )
}
