import { useEffect, useState } from "react"
import { driverAllExpenses } from "./driverApi"

/**
 * Every claim this driver has filed.
 *
 * Expenses could already be filed against a trip, and read back on that trip.
 * That answers the question only while the trip is open — and "am I getting
 * paid back for the fuel I bought in Tagum last week" is asked at home, days
 * later, with no trip on screen. Until now the app could not answer it at all,
 * which is the sort of gap that quietly teaches people to keep their own
 * notebook instead.
 *
 * The screen leads with what is still owed, because that is the number the
 * driver opened it for. Everything under it is the evidence for that number.
 */
export default function DriverClaims() {
  const [state, setState] = useState(null)
  const [err, setErr] = useState("")

  useEffect(() => {
    driverAllExpenses().then(setState).catch((e) => setErr(e.message))
  }, [])

  if (err) return <div className="dr-scroll"><div className="dr-err">{err}</div></div>
  if (!state) return <div className="dr-scroll dr-loading">Loading…</div>

  const { rows, totals } = state

  if (!rows.length) {
    return (
      <div className="dr-scroll">
        <div className="dr-empty">
          <div className="dr-empty-title">No claims yet</div>
          <div className="dr-empty-sub">
            Fuel, toll and parking receipts you file on a trip show up here.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="dr-scroll">
      <section className="dr-owed">
        <span className="dr-owed-label">Still to come back to you</span>
        <span className="dr-owed-n">{peso(outstanding(totals))}</span>
        <span className="dr-owed-sub">{breakdown(totals)}</span>
      </section>

      <div className="dr-section">
        <span className="dr-section-title">Everything you have filed</span>
        <span className="dr-section-count">{rows.length}</span>
      </div>

      {rows.map((c) => (
        <ClaimRow key={c.id} claim={c} />
      ))}
    </div>
  )
}

const peso = (n) =>
  `₱${Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * Money not yet in the driver's pocket that has not been turned down.
 *
 * Deliberately not "everything I ever claimed". A claim marked reimbursed has
 * already been paid, and counting it here would tell a driver they are owed
 * money twice — which ends with them chasing finance for it, or claiming for
 * it again.
 */
const outstanding = (t) => (t.waiting || 0) + (t.approved || 0)

/**
 * The second line under the headline.
 *
 * A rejected claim is the one a driver most needs to notice, so it is named
 * plainly rather than folded into a total.
 */
function breakdown(totals) {
  const bits = []
  if (totals.waiting) bits.push(`${peso(totals.waiting)} with finance`)
  if (totals.approved) bits.push(`${peso(totals.approved)} approved, not yet paid`)
  if (totals.paid) bits.push(`${peso(totals.paid)} already paid back`)
  if (totals.rejected) bits.push(`${peso(totals.rejected)} not approved`)
  return bits.length ? bits.join(" · ") : "Nothing filed yet"
}

const day = (d) =>
  d ? new Date(d).toLocaleDateString("en-PH", { day: "numeric", month: "short", year: "numeric" }) : "—"

/*
 * Finance has its own vocabulary for these; a driver needs the plain one.
 *
 * "Recorded" in particular means the claim was accepted into the books, which
 * to anyone outside accounting sounds like nothing has happened yet.
 */
const SAYS = {
  submitted: "With finance",
  recorded: "Approved",
  on_voucher: "On a voucher",
  reimbursed: "Paid back",
  rejected: "Not approved",
}

const TONES = {
  submitted: "wait",
  recorded: "ok",
  on_voucher: "ok",
  reimbursed: "ok",
  rejected: "danger",
}

function ClaimRow({ claim }) {
  const tone = TONES[claim.status] || "wait"

  return (
    <article className="dr-claim" data-tone={tone}>
      <span className="dr-claim-main">
        <span className="dr-claim-top">
          <span className="dr-claim-cat">{claim.category}</span>
          <span className="dr-claim-amt">{peso(claim.amount)}</span>
        </span>

        <span className="dr-claim-meta">
          <span>{day(claim.expenseDate)}</span>
          {claim.ticketNo && <span>{claim.ticketNo}</span>}
          {claim.hasReceipt ? <span>Receipt attached</span> : <span className="warn">No receipt</span>}
        </span>

        {claim.description && <span className="dr-claim-desc">{claim.description}</span>}

        {/* The reason a claim was turned down is the single most useful thing
            on this screen, so it is never truncated or hidden behind a tap. */}
        {claim.status === "rejected" && claim.reviewNote && (
          <span className="dr-claim-why">{claim.reviewNote}</span>
        )}
      </span>

      <span className="dr-claim-state">{SAYS[claim.status] || claim.status}</span>
    </article>
  )
}
