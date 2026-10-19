import { useCallback, useEffect, useMemo, useState } from "react"
import { driverAllExpenses } from "./driverApi"
import { StatTile, fmtWhen } from "./DriverBits"
import { Badge, Chevron, DetailHead, EmptyArt, FactList, FindBar } from "./DriverListBits"
import DriverClaimForm, { CATEGORIES } from "./DriverClaimForm"

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
 *
 * The counts, search and filters all work on the claims the phone has loaded
 * (the most recent sixty). The money figure is the server's own total.
 */
export default function DriverClaims({ detail, onDetail }) {
  const [state, setState] = useState(null)
  const [err, setErr] = useState("")

  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState("all")
  const [category, setCategory] = useState("all")

  const load = useCallback(() => {
    driverAllExpenses().then(setState).catch((e) => setErr(e.message))
  }, [])
  useEffect(() => { load() }, [load])

  const rows = state?.rows
  const shown = useMemo(() => (rows ? filterClaims(rows, { query, status, category }) : []), [rows, query, status, category])

  if (detail?.compose) {
    return (
      <DriverClaimForm
        onBack={() => onDetail(null)}
        onDone={() => { load(); onDetail(null) }}
      />
    )
  }
  if (detail?.claim) {
    return <DriverClaimDetail claim={detail.claim} onBack={() => onDetail(null)} />
  }

  if (err) return <div className="dr-scroll"><div className="dr-err">{err}</div></div>
  if (!state) return <div className="dr-scroll dr-loading">Loading…</div>

  const { totals } = state
  const compose = () => onDetail({ compose: true })

  if (!rows.length) {
    return (
      <div className="dr-scroll">
        <div className="dr-empty">
          <EmptyArt />
          <div className="dr-empty-title">No claims yet</div>
          <div className="dr-empty-sub">
            Fuel, toll, parking and other costs you pay on a run can be claimed back here.
          </div>
          <button type="button" className="dr-btn dr-empty-cta" onClick={compose}>Submit a claim</button>
        </div>

        <ol className="dr-howto">
          <li><span>1</span>Choose the run and enter what you spent.</li>
          <li><span>2</span>Attach a photo of the receipt.</li>
          <li><span>3</span>Finance reviews it. The result, and any remarks, show up here.</li>
        </ol>
      </div>
    )
  }

  const count = (...s) => rows.filter((r) => s.includes(r.status)).length
  const presentStatus = [...new Set(rows.map((r) => r.status))].filter((s) => SAYS[s])
  const presentCategory = [...new Set(rows.map((r) => r.category))]
  const activeCount = (status !== "all" ? 1 : 0) + (category !== "all" ? 1 : 0)
  const filtering = Boolean(query.trim()) || activeCount > 0
  const clear = () => { setQuery(""); setStatus("all"); setCategory("all") }

  return (
    <div className="dr-scroll">
      <section className="dr-claims-dashboard" aria-label="Claims overview">
        <div className="dr-claims-balance">
          <span className="dr-claims-balance-icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 7.5h15a1 1 0 0 1 1 1V18a2 2 0 0 1-2 2H5a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3h12" />
              <path d="M16 12h4v4h-4a2 2 0 0 1 0-4Z" />
            </svg>
          </span>
          <span className="dr-claims-balance-copy">
            <span className="dr-claims-balance-label">Still to come back to you</span>
            <span className="dr-claims-balance-value">{peso(outstanding(totals))}</span>
            <span className="dr-claims-balance-sub">{breakdown(totals)}</span>
          </span>
        </div>

        <div className="dr-stats dr-stats-4 dr-claims-metrics" aria-label="Claim totals by status">
          <StatTile label="Total" value={rows.length} />
          <StatTile label="Pending" value={count("submitted")} />
          <StatTile label="Approved" value={count("recorded", "on_voucher", "reimbursed")} />
          <StatTile label="Rejected" value={count("rejected")} />
        </div>
      </section>

      <button type="button" className="dr-btn dr-claim-new" onClick={compose}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        Submit a claim
      </button>

      <FindBar
        value={query}
        onChange={setQuery}
        placeholder="Search category, run or note"
        label="Search your claims"
        open={open}
        onToggle={() => setOpen((o) => !o)}
        activeCount={activeCount}
      >
        {presentStatus.length > 1 && (
          <div className="dr-find-group">
            <span className="dr-label">Status</span>
            <div className="dr-chips">
              {["all", ...presentStatus].map((s) => (
                <button key={s} type="button" className={`dr-chip ${status === s ? "on" : ""}`}
                        aria-pressed={status === s} onClick={() => setStatus(s)}>
                  {s === "all" ? "All" : SAYS[s]}
                </button>
              ))}
            </div>
          </div>
        )}
        {presentCategory.length > 1 && (
          <div className="dr-find-group">
            <span className="dr-label">Category</span>
            <div className="dr-chips">
              {["all", ...presentCategory].map((c) => (
                <button key={c} type="button" className={`dr-chip ${category === c ? "on" : ""}`}
                        aria-pressed={category === c} onClick={() => setCategory(c)}>
                  {c === "all" ? "All" : categoryLabel(c)}
                </button>
              ))}
            </div>
          </div>
        )}
        {filtering && <button type="button" className="dr-find-clear" onClick={clear}>Clear search and filters</button>}
      </FindBar>

      <div className="dr-section dr-claims-list-head">
        <span className="dr-section-copy">
          <span className="dr-section-title">Claim history</span>
          <span className="dr-section-sub">Tap a claim to see all details</span>
        </span>
        <span className="dr-section-count">{filtering ? `${shown.length} of ${rows.length}` : rows.length}</span>
      </div>

      {shown.length === 0 ? (
        <div className="dr-empty">
          <EmptyArt />
          <div className="dr-empty-title">No claims match</div>
          <div className="dr-empty-sub">Try a different search or filter.</div>
          <button type="button" className="dr-btn-quiet dr-empty-action" onClick={clear}>Clear search and filters</button>
        </div>
      ) : (
        <div className="dr-claim-list">
          {shown.map((c) => <ClaimRow key={c.id} claim={c} onOpen={() => onDetail({ claim: c })} />)}
        </div>
      )}
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
  recorded: "info",
  on_voucher: "info",
  reimbursed: "ok",
  rejected: "danger",
}

/** What a driver is told the status means for them, on the claim itself. */
const MEANS = {
  submitted: "Finance has not reviewed this yet. The result, and any remarks, will show here.",
  recorded: "Finance approved this claim. It has not been paid back yet.",
  on_voucher: "Finance approved this claim and it is on a payment voucher.",
  reimbursed: "This claim has been paid back.",
  rejected: "Finance did not approve this claim.",
}

const categoryLabel = (c) => CATEGORIES.find((x) => x.value === c)?.label || String(c || "").replace(/^./, (m) => m.toUpperCase())

/** Search matches the category, the run, the driver's own note and the amount. */
export function filterClaims(rows, { query = "", status = "all", category = "all" }) {
  const q = query.trim().toLowerCase()
  return rows.filter((r) => {
    if (status !== "all" && r.status !== status) return false
    if (category !== "all" && r.category !== category) return false
    if (q) {
      const hay = [categoryLabel(r.category), r.category, r.ticketNo, r.description, r.receiptNo, String(r.amount)]
        .filter(Boolean).join(" ").toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

function ClaimRow({ claim, onOpen }) {
  const label = SAYS[claim.status] || claim.status
  return (
    <button
      type="button"
      className="dr-claim tap"
      data-tone={TONES[claim.status] || "wait"}
      onClick={onOpen}
      aria-label={`${categoryLabel(claim.category)}, ${peso(claim.amount)}, ${label}`}
    >
      <span className="dr-claim-main">
        <span className="dr-claim-top">
          <span className="dr-claim-cat">{categoryLabel(claim.category)}</span>
          <span className="dr-claim-amt">{peso(claim.amount)}</span>
        </span>

        <span className="dr-claim-line">
          <Badge tone={TONES[claim.status] || "wait"}>{label}</Badge>
          <span className="dr-claim-meta">
            <span>{day(claim.expenseDate)}</span>
            {claim.ticketNo && <span>{claim.ticketNo}</span>}
            {!claim.hasReceipt && <span className="warn">No receipt</span>}
          </span>
        </span>

        {claim.description && <span className="dr-claim-desc">{claim.description}</span>}

        {/* The reason a claim was turned down is the single most useful thing
            on this screen, so it is never truncated or hidden behind a tap. */}
        {claim.status === "rejected" && claim.reviewNote && (
          <span className="dr-claim-why">
            <span className="dr-claim-why-label">Finance note</span>
            <span>{claim.reviewNote}</span>
          </span>
        )}
      </span>
      <Chevron />
    </button>
  )
}

/**
 * One claim, with everything the system holds about it.
 *
 * The receipt photo itself is not shown: the phone is told that one is attached
 * but is not given a way to fetch it.
 */
function DriverClaimDetail({ claim, onBack }) {
  const tone = TONES[claim.status] || "wait"
  return (
    <div className="dr-scroll">
      <DetailHead
        title={categoryLabel(claim.category)}
        sub={claim.ticketNo ? `Run ${claim.ticketNo}` : null}
        onBack={onBack}
        badge={<Badge tone={tone}>{SAYS[claim.status] || claim.status}</Badge>}
      />

      <div className="dr-claim-hero" data-tone={tone}>
        <span className="dr-claim-hero-amt">{peso(claim.amount)}</span>
        <span className="dr-claim-hero-says">{MEANS[claim.status] || ""}</span>
      </div>

      <div className="dr-block">
        <div className="dr-block-body">
          <FactList
            rows={[
              { label: "Category", value: categoryLabel(claim.category) },
              { label: "Amount", value: peso(claim.amount) },
              { label: "Expense date", value: day(claim.expenseDate) },
              { label: "Related run", value: claim.ticketNo },
              { label: "Receipt / OR no.", value: claim.receiptNo },
              { label: "Receipt photo", value: claim.hasReceipt ? "Attached" : "None attached" },
              { label: "Filed", value: fmtWhen(claim.createdAt) },
              { label: "Reviewed", value: fmtWhen(claim.reviewedAt) },
            ]}
          />
        </div>
      </div>

      {claim.description && (
        <div className="dr-block">
          <div className="dr-block-head"><span className="dr-block-title">Your notes</span></div>
          <div className="dr-block-body dr-prose">{claim.description}</div>
        </div>
      )}

      {claim.reviewNote && (
        <div className="dr-block" data-tone={claim.status === "rejected" ? "danger" : "info"}>
          <div className="dr-block-head"><span className="dr-block-title">Finance remarks</span></div>
          <div className="dr-block-body dr-prose">{claim.reviewNote}</div>
        </div>
      )}
    </div>
  )
}
