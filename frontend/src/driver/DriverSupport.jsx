import { useCallback, useEffect, useRef, useState } from "react"
import {
  driverPauseHistory, driverPauseResume, driverPauseWithdraw, driverSupportCreate, driverSupportGet,
  driverSupportList, driverSupportReopen,
  driverSupportReply, driverTrips,
} from "./driverApi"
import { Badge, Chevron, DetailHead } from "./DriverListBits"
import BackToTop from "./BackToTop"
import ChipRow from "./ChipRow"
import Paged from "./Paged"
import DriverFaq from "./DriverFaq"
import PauseCard from "./PauseCard"
import { NeedsInternet } from "./DriverBits"
import { useNetStatus } from "./netStatus"
import PushToggle from "./PushToggle"
import PauseForm from "./PauseForm"
import {
  SUPPORT_CATEGORIES, SUPPORT_STATUS, categoryLabel, formatMinutes, newClientRef, outcomeOf,
  ticketIsActive, turnOf,
} from "./supportKinds"
import { tap } from "./native"
import DriverLoader from "./DriverLoader"
import { LeadIcon, SUPPORT_ICON } from "./DriverIcons"

/**
 * Help & Support: where a driver tells the office what they need.
 *
 * A problem on the road, a delivery that has to stop, a question about pay, an
 * app that will not sign in. Each is a request with a thread under it, so the
 * answer arrives where the question was asked and is still there next week. A
 * request that asks to pause a delivery is the same thing with a decision
 * attached, and carries a card that says where that decision stands.
 *
 * The first screen is a hub: four things a driver may need, labelled in words
 * and not only pictures, then their requests, their pause history and the
 * answers they can read for themselves. Out of signal a request is parked on
 * the phone and sent later, and the confirmation says so in so many words.
 *
 * One component, so the phone's back button has one place to ask. `detail` says
 * which screen is open: null (the hub), { compose }, { pause }, { ticketId }.
 */

const day = (value) =>
  new Date(value).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })

const POLL_LIST_MS = 30000
const POLL_THREAD_MS = 10000

/** Re-run `load` on a timer while the app is in front, and again on coming back to it. */
function useRefresh(load, ms) {
  useEffect(() => {
    load()
    const id = window.setInterval(() => { if (document.visibilityState === "visible") load() }, ms)
    const onVisible = () => { if (document.visibilityState === "visible") load() }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [load, ms])
}

const iconProps = {
  width: 26, height: 26, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
  strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true,
}
const Icons = {
  pause: <svg {...iconProps}><circle cx="12" cy="12" r="9" /><path d="M10 9v6M14 9v6" /></svg>,
  report: <svg {...iconProps}><path d="M4 21V4M4 5h12l-2 4 2 4H4" /></svg>,
  emergency: <svg {...iconProps}><path d="M12 3 2.5 20h19z" /><path d="M12 10v4M12 17.2v.01" /></svg>,
  faq: <svg {...iconProps}><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.8M12 17v.01" /></svg>,
}

/* ------------------------------------------------------------------ */
/* The hub                                                             */
/* ------------------------------------------------------------------ */

function Tile({ icon, title, sub, tone, onClick }) {
  return (
    <button type="button" className="dr-help-tile" data-tone={tone} onClick={() => { tap("light"); onClick() }}>
      <span className="dr-help-tile-icon">{icon}</span>
      <span className="dr-help-tile-title">{title}</span>
      <span className="dr-help-tile-sub">{sub}</span>
    </button>
  )
}

function SupportRow({ ticket, onOpen }) {
  const says = SUPPORT_STATUS[ticket.status] || SUPPORT_STATUS.open
  // One badge, saying whose move it is while a request is being worked: two
  // statuses side by side ("Sent" beside "Office replied") read as a contradiction.
  const turn = turnOf(ticket)
  const badge = turn === "driver" ? { label: "Office replied", tone: "info" }
    : turn === "office" ? { label: "Waiting for the office", tone: "wait" }
    : says
  return (
    <button
      type="button"
      className="dr-claim tap"
      data-tone={badge.tone}
      onClick={onOpen}
      aria-label={`${ticket.subject}, ${says.label}${ticket.unread ? ", new reply" : ""}`}
    >
      <LeadIcon name={ticket.pause ? "clock" : (SUPPORT_ICON[ticket.category] || "question")} />
      <span className="dr-claim-main">
        <span className="dr-claim-top">
          <span className="dr-claim-cat dr-support-subject">{ticket.subject}</span>
          {ticket.unread && <span className="dr-support-new">New reply</span>}
        </span>
        <span className="dr-claim-line">
          <Badge tone={badge.tone}>{badge.label}</Badge>
          <span className="dr-claim-meta">
            <span>{ticket.ticketNo}</span>
            <span>{ticket.pause ? "Pause request" : categoryLabel(ticket.category)}</span>
            {ticket.priority === "urgent" && <span className="warn">Urgent</span>}
          </span>
        </span>
        {ticket.lastBody && (
          <span className="dr-claim-desc">
            {ticket.lastSender === "staff" ? "Office: " : "You: "}
            {ticket.lastBody}
          </span>
        )}
      </span>
      <Chevron />
    </button>
  )
}

const FILTERS = [
  { id: "all", label: "All" },
  { id: "pause", label: "Pause requests" },
  { id: "problem", label: "Problems" },
]

const TABS = [
  { id: "requests", label: "Requests" },
  { id: "history", label: "History" },
  { id: "faq", label: "FAQs" },
]

/** A request that is over: how it ended, when, and for a pause how long the delivery was held. */
function HistoryRow({ ticket, heldMinutes, onOpen }) {
  const outcome = outcomeOf(ticket)
  const held = formatMinutes(heldMinutes)
  const when = ticket.resolvedAt || ticket.updatedAt
  return (
    <button
      type="button"
      className="dr-claim tap"
      data-tone={outcome.tone}
      onClick={onOpen}
      aria-label={`${ticket.subject}, ${outcome.label}`}
    >
      <LeadIcon name={ticket.pause ? "clock" : (SUPPORT_ICON[ticket.category] || "question")} tone="neutral" />
      <span className="dr-claim-main">
        <span className="dr-claim-top">
          <span className="dr-claim-cat dr-support-subject">{ticket.subject}</span>
        </span>
        <span className="dr-claim-line">
          <Badge tone={outcome.tone}>{outcome.label}</Badge>
          <span className="dr-claim-meta">
            <span>{ticket.ticketNo}</span>
            <span>{ticket.pause ? "Pause request" : categoryLabel(ticket.category)}</span>
            {when && <span>{day(when)}</span>}
            {held && ticket.pause?.status === "resumed" && <span>Held {held}</span>}
          </span>
        </span>
      </span>
      <Chevron />
    </button>
  )
}

function SupportHub({ tab, onTab, onCompose, onPause, onOpen, onBack }) {
  const [tickets, setTickets] = useState(null)
  const [pauses, setPauses] = useState(null)
  const [err, setErr] = useState("")
  const [filter, setFilter] = useState("all")
  const [query, setQuery] = useState("")

  const load = useCallback(() => {
    driverSupportList()
      .then((rows) => { setTickets(rows); setErr("") })
      .catch((e) => setErr(e.message || "Could not load your requests."))
    driverPauseHistory().then(setPauses).catch(() => setPauses((cur) => cur ?? []))
  }, [])
  useRefresh(load, POLL_LIST_MS)

  const faqAction = (action) => (action === "pause" ? onPause() : onCompose())

  // Requests still being worked stay here, the ones with an answer waiting first. A request
  // that is resolved or closed moves to History by itself, and comes back if the driver writes on it.
  const rank = (t) => (t.unread ? 0 : turnOf(t) === "driver" ? 1 : 2)
  const active = (tickets || []).filter(ticketIsActive).sort((a, b) => rank(a) - rank(b))
  const finished = (tickets || []).filter((t) => !ticketIsActive(t))
  // an answer waiting is counted on the tab it is in, so a reply that closes a request is not lost
  const unread = { requests: active.filter((t) => t.unread).length, history: finished.filter((t) => t.unread).length }
  const heldBy = new Map((pauses || []).map((p) => [p.id, p.pausedMinutes]))

  const q = query.trim().toLowerCase()
  const shownHistory = finished.filter((t) => {
    if (filter === "pause" && !t.pause) return false
    if (filter === "problem" && t.pause) return false
    if (!q) return true
    return [t.subject, t.ticketNo, t.tripNo, outcomeOf(t).label].some((v) => String(v || "").toLowerCase().includes(q))
  })

  return (
    <div className="dr-scroll">
      <DetailHead title="Help & Support" sub="Report a problem, pause a delivery, get answers" onBack={onBack} />

      <PushToggle />

      <div className="dr-help-tiles">
        <Tile icon={Icons.pause} title="Pause delivery" sub="Breakdown, delay or incident on the road" onClick={onPause} />
        <Tile icon={Icons.report} title="Report a problem" sub="A concern, pay, or help with the app" onClick={onCompose} />
        <Tile icon={Icons.emergency} title="Emergency" sub="Someone hurt or in danger" tone="danger" onClick={() => onPause("emergency")} />
        <Tile icon={Icons.faq} title="FAQs and guides" sub="Answers and troubleshooting" onClick={() => onTab("faq")} />
      </div>

      <div className="dr-htabs" role="tablist" aria-label="Help and support">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`help-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="help-panel"
            className="dr-htab"
            onClick={() => onTab(t.id)}
          >
            {t.label}
            {unread[t.id] > 0 && <span className="dr-htab-count">{unread[t.id]}</span>}
          </button>
        ))}
      </div>

      <div id="help-panel" role="tabpanel" aria-labelledby={`help-tab-${tab}`}>
        {tab === "requests" && (
          <>
            {err && !tickets && <div className="dr-err">{err}</div>}
            {tickets == null && !err && <DriverLoader variant="inline" label="Loading your requests…" />}
            {tickets && active.length === 0 && (
              <div className="dr-empty">
                <div className="dr-empty-title">{finished.length ? "No active requests" : "Nothing sent yet"}</div>
                <div className="dr-empty-text">
                  {finished.length
                    ? "Everything you sent has been finished. Past requests are kept in History."
                    : "Report a problem, ask about pay, or get help with the app. The office answers here."}
                </div>
                {finished.length > 0 && (
                  <button type="button" className="dr-btn ghost" style={{ marginTop: 12 }} onClick={() => onTab("history")}>
                    Open History
                  </button>
                )}
              </div>
            )}
            {active.length > 0 && (
              <Paged items={active} storeKey="requests" noun="requests">
                {(rows) => (
                  <div className="dr-support-list">
                    {rows.map((t) => <SupportRow key={t.id} ticket={t} onOpen={() => onOpen(t.id)} />)}
                  </div>
                )}
              </Paged>
            )}
          </>
        )}

        {tab === "history" && (
          <>
            {tickets == null && !err && <DriverLoader variant="inline" label="Loading your requests…" />}
            {err && !tickets && <div className="dr-err">{err}</div>}
            {tickets && finished.length === 0 && (
              <div className="dr-empty">
                <div className="dr-empty-title">No finished requests yet</div>
                <div className="dr-empty-text">
                  When a request is resolved, declined or withdrawn, it moves here and leaves your Requests list.
                </div>
              </div>
            )}
            {tickets && finished.length > 0 && (
              <>
                <label className="dr-find-box dr-history-find">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                  <span className="dr-sr-only">Search past requests</span>
                  <input
                    className="dr-find-input"
                    type="search"
                    placeholder="Search past requests"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                <div className="dr-chips dr-history-filter" role="group" aria-label="Kind of request">
                  {FILTERS.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      className={`dr-chip ${filter === f.id ? "on" : ""}`}
                      aria-pressed={filter === f.id}
                      onClick={() => setFilter(f.id)}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                {shownHistory.length === 0 ? (
                  <div className="dr-empty">
                    <div className="dr-empty-title">No matches</div>
                    <div className="dr-empty-text">Try another word, or choose All.</div>
                  </div>
                ) : (
                  <Paged items={shownHistory} resetKey={`${filter}|${query}`} storeKey="history" noun="requests">
                    {(rows) => (
                      <div className="dr-support-list">
                        {rows.map((t) => (
                          <HistoryRow key={t.id} ticket={t} heldMinutes={heldBy.get(t.pause?.id)} onOpen={() => onOpen(t.id)} />
                        ))}
                      </div>
                    )}
                  </Paged>
                )}
              </>
            )}
          </>
        )}

        {tab === "faq" && <DriverFaq onAction={faqAction} />}
      </div>

      <BackToTop />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* A new request                                                       */
/* ------------------------------------------------------------------ */

function SupportForm({ preset, onBack, onDone, onOpen }) {
  const emergency = preset === "emergency"
  const [category, setCategory] = useState(emergency ? "safety" : "")
  const [subject, setSubject] = useState("")
  const [message, setMessage] = useState("")
  const [tripId, setTripId] = useState("")
  const [urgent, setUrgent] = useState(emergency)
  const [trips, setTrips] = useState([])
  const [errors, setErrors] = useState({})
  const [serverErr, setServerErr] = useState("")
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(null) // { ticket }
  const offline = useNetStatus() === "offline"
  // one reference per form, kept across retries, so a send lost on the way back
  // is filed once however many times the button is pressed
  const clientRef = useRef(newClientRef())

  useEffect(() => {
    let live = true
    driverTrips()
      .then((rows) => { if (live) setTrips(rows.slice(0, 6)) })
      .catch(() => { /* linking a run is optional */ })
    return () => { live = false }
  }, [])

  function validate() {
    const e = {}
    if (!category) e.category = "Choose what this is about."
    if (subject.trim().length < 3) e.subject = "Give it a short title."
    if (!message.trim()) e.message = "Tell the office what happened or what you need."
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
      const out = await driverSupportCreate({
        category,
        subject: subject.trim(),
        message: message.trim(),
        tripId: tripId || undefined,
        urgent,
        clientRef: clientRef.current,
      })
      setSent({ ticket: out?.data || null })
    } catch (e2) {
      setServerErr(e2.message || "Could not send that request.")
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <div className="dr-scroll">
        <DetailHead title="New request" onBack={onDone} />
        <div className="dr-done">
          <span className="dr-done-mark" aria-hidden="true">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 13 4 4L19 7" /></svg>
          </span>
          <h2 className="dr-done-title">Sent to the office</h2>
          <p className="dr-done-text">
            {`Your request is ${sent.ticket?.ticketNo || "in"}. Replies appear here, and a dot shows on the help button when there is one.`}
          </p>
        </div>
        {sent.ticket?.id && (
          <button type="button" className="dr-btn" onClick={() => onOpen(sent.ticket.id)}>View request</button>
        )}
        <button type="button" className={!sent.ticket?.id ? "dr-btn" : "dr-btn ghost"} style={{ marginTop: 10 }} onClick={onDone}>
          Back to Help &amp; Support
        </button>
      </div>
    )
  }

  return (
    <form className="dr-scroll dr-claimform" onSubmit={submit} noValidate>
      <DetailHead title={emergency ? "Emergency" : "New request"} sub="The office will reply here" onBack={onBack} />

      {emergency && (
        <div className="dr-note dr-support-emergency" role="note">
          <span>Call <strong>911</strong> first if anyone is hurt. This tells the office.</span>
        </div>
      )}

      <fieldset className="dr-group" disabled={busy}>
        <legend className="dr-group-title">What is it about? <em>*</em></legend>
        <ChipRow label="What the request is about">
          {SUPPORT_CATEGORIES.map((c) => (
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
        </ChipRow>
        {errors.category && <p className="dr-fielderr" role="alert">{errors.category}</p>}
      </fieldset>

      <fieldset className="dr-group" disabled={busy}>
        <legend className="dr-group-title">Details</legend>
        <label className="dr-label" htmlFor="support-subject">Title <em>*</em></label>
        <input
          id="support-subject"
          className="dr-field"
          value={subject}
          maxLength={120}
          placeholder="e.g. Flat tyre on the highway"
          aria-invalid={Boolean(errors.subject)}
          onChange={(e) => setSubject(e.target.value)}
        />
        {errors.subject && <p className="dr-fielderr" role="alert">{errors.subject}</p>}

        <label className="dr-label" htmlFor="support-message">What happened, or what do you need? <em>*</em></label>
        <textarea
          id="support-message"
          className="dr-field"
          rows={5}
          maxLength={2000}
          placeholder="Where you are, what is wrong, and anything the office should know."
          value={message}
          aria-invalid={Boolean(errors.message)}
          onChange={(e) => setMessage(e.target.value)}
        />
        {errors.message && <p className="dr-fielderr" role="alert">{errors.message}</p>}
      </fieldset>

      {trips.length > 0 && (
        <fieldset className="dr-group" disabled={busy}>
          <legend className="dr-group-title">Related run <span className="dr-opt">(optional)</span></legend>
          <ChipRow label="Related run">
            <button
              type="button"
              className={`dr-chip ${tripId === "" ? "on" : ""}`}
              aria-pressed={tripId === ""}
              onClick={() => setTripId("")}
            >
              None
            </button>
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
          </ChipRow>
        </fieldset>
      )}

      <label className="dr-check" data-on={urgent ? "yes" : "no"}>
        <input type="checkbox" checked={urgent} disabled={busy} onChange={(e) => setUrgent(e.target.checked)} />
        <span className="dr-check-box" aria-hidden="true" />
        <span className="dr-check-text">
          <strong>This is urgent</strong>
          <span>I need help now. The office sees it first.</span>
        </span>
      </label>

      {(serverErr || Object.keys(errors).length > 0) && (
        <div className="dr-formerr" role="alert">
          {serverErr || "Please fill in the highlighted fields before sending."}
        </div>
      )}

      <div className="dr-actionbar">
        <button type="submit" className="dr-btn" disabled={busy || offline}>
          {busy ? "Sending…" : "Send to the office"}
        </button>
        {offline && <NeedsInternet>Sending a request</NeedsInternet>}
      </div>
    </form>
  )
}

/* ------------------------------------------------------------------ */
/* One request's conversation                                          */
/* ------------------------------------------------------------------ */

/** Sent, answered, resolved: where an ordinary request is on the way. */
function TicketSteps({ ticket }) {
  const answered = Boolean(ticket.acknowledgedAt) || ticket.status !== "open"
  const done = ticket.status === "resolved" || ticket.status === "closed"
  const steps = [
    { key: "sent", label: "Sent", time: day(ticket.createdAt), state: "done" },
    { key: "ans", label: "Answered", time: ticket.acknowledgedAt ? day(ticket.acknowledgedAt) : null, state: answered ? "done" : "active" },
    { key: "res", label: ticket.status === "closed" ? "Closed" : "Resolved", time: done && ticket.resolvedAt ? day(ticket.resolvedAt) : null, state: done ? "done" : answered ? "active" : "todo" },
  ]
  return (
    <ol className="dr-pause-steps dr-ticket-steps" aria-label="Progress">
      {steps.map((s) => (
        <li key={s.key} className="dr-pause-step" data-state={s.state}>
          <span className="dr-pause-step-dot" aria-hidden="true" />
          <span className="dr-pause-step-label">{s.label}</span>
          {s.time && <span className="dr-pause-step-time">{s.time}</span>}
        </li>
      ))}
    </ol>
  )
}

function SupportThread({ id, onBack }) {
  const [ticket, setTicket] = useState(null)
  const [err, setErr] = useState("")
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const [sendErr, setSendErr] = useState("")
  const [pauseBusy, setPauseBusy] = useState(false)
  const [pauseErr, setPauseErr] = useState("")
  const [reopening, setReopening] = useState(false)
  const [reopenErr, setReopenErr] = useState("")
  const offline = useNetStatus() === "offline"
  const end = useRef(null)
  const retry = useRef(null) // { body, clientRef } of the last reply that failed

  const load = useCallback(() => {
    driverSupportGet(id)
      .then((t) => { setTicket(t); setErr("") })
      .catch((e) => setErr(e.message || "Could not load this request."))
  }, [id])
  useRefresh(load, POLL_THREAD_MS)

  const count = ticket?.messages?.length || 0
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" })
  }, [count])

  async function send(ev) {
    ev.preventDefault()
    const body = text.trim()
    if (!body || busy) return
    setSendErr("")
    setBusy(true)
    // A failed send may have reached the office and lost only its answer, so the
    // same words sent again keep their clientRef and are stored once.
    const clientRef = retry.current?.body === body ? retry.current.clientRef : newClientRef()
    try {
      await driverSupportReply(id, body, clientRef)
      retry.current = null
      setText("")
      load()
    } catch (e2) {
      retry.current = { body, clientRef }
      setSendErr(e2.message || "Could not send that.")
    } finally {
      setBusy(false)
    }
  }

  async function reopen() {
    setReopenErr("")
    setReopening(true)
    try {
      await driverSupportReopen(id)
      tap("light")
      load()
    } catch (e2) {
      setReopenErr(e2.message || "Could not reopen this request.")
    } finally {
      setReopening(false)
    }
  }

  async function endPause(action) {
    setPauseErr("")
    setPauseBusy(true)
    try {
      await action(ticket.pause.tripId)
      tap("light")
      load()
    } catch (e2) {
      setPauseErr(e2.message || "Could not do that.")
    } finally {
      setPauseBusy(false)
    }
  }

  if (err && !ticket) {
    return (
      <div className="dr-scroll">
        <DetailHead title="Request" onBack={onBack} />
        <div className="dr-err">{err}</div>
      </div>
    )
  }
  if (!ticket) {
    return (
      <div className="dr-scroll">
        <DetailHead title="Request" onBack={onBack} />
        <DriverLoader variant="screen" label="Opening your request…" />
      </div>
    )
  }

  const says = SUPPORT_STATUS[ticket.status] || SUPPORT_STATUS.open
  const closed = ticket.status === "closed"
  // a pause request is a record of what happened to a delivery; a problem that comes back is a new request
  const canReopen = (ticket.status === "closed" || ticket.status === "resolved") && !ticket.pause
  const reopenButton = canReopen && (
    <>
      {reopenErr && <div className="dr-err tight" role="alert">{reopenErr}</div>}
      <button type="button" className="dr-btn ghost dr-reopen" disabled={reopening} onClick={reopen}>
        {reopening ? "Reopening…" : "Reopen request"}
      </button>
    </>
  )

  return (
    <div className="dr-support-thread">
      <div className="dr-support-thread-head">
        <DetailHead
          title={ticket.ticketNo}
          sub={`${ticket.subject}`}
          onBack={onBack}
          badge={<Badge tone={says.tone}>{says.label}</Badge>}
        />
        <div className="dr-support-meta">
          <span>{ticket.pause ? "Pause request" : categoryLabel(ticket.category)}</span>
          {ticket.tripNo && <span>Run {ticket.tripNo}</span>}
          {ticket.priority === "urgent" && <span className="warn">Urgent</span>}
          {ticket.assignedName && <span>Handled by {ticket.assignedName}</span>}
        </div>
      </div>

      <div className="dr-support-msgs" role="log" aria-label="Conversation">
        {ticket.pause ? (
          <PauseCard
            pause={ticket.pause}
            busy={pauseBusy}
            error={pauseErr}
            onResume={() => endPause(driverPauseResume)}
            onWithdraw={() => endPause(driverPauseWithdraw)}
          />
        ) : (
          <TicketSteps ticket={ticket} />
        )}
        {ticket.messages.map((m) => (
          <div key={m.id} className="dr-support-msg" data-mine={m.mine ? "yes" : "no"}>
            <span className="dr-support-who">{m.mine ? "You" : m.senderName || "Office"}</span>
            <span className="dr-support-body">{m.body}</span>
            <span className="dr-support-when">{day(m.createdAt)}</span>
          </div>
        ))}
        <div ref={end} />
      </div>

      {closed ? (
        <div className="dr-note dr-note-quiet dr-support-closed">
          <span>{canReopen ? "This request is closed. Reopen it if it is not fixed, or start a new one." : "This request is closed. Start a new one if you still need help."}</span>
          {reopenButton}
        </div>
      ) : (
        <form className="dr-support-compose" onSubmit={send}>
          {ticket.status === "resolved" && (
            <p className="dr-support-hint">Marked resolved. Writing here opens it again.</p>
          )}
          {ticket.status === "resolved" && reopenButton}
          {sendErr && <div className="dr-err tight" role="alert">{sendErr}</div>}
          <div className="dr-support-compose-row">
            <textarea
              className="dr-field"
              rows={2}
              maxLength={2000}
              aria-label="Write a message"
              placeholder="Write a message"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <button type="submit" className="dr-btn" disabled={busy || offline || !text.trim()}>
              {busy ? "…" : "Send"}
            </button>
          </div>
          {offline && <NeedsInternet />}
        </form>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* The screen                                                          */
/* ------------------------------------------------------------------ */

export default function DriverSupport({ detail, onDetail, onBack }) {
  // kept here, not in the hub, so coming back from a request lands on the same tab
  const [tab, setTab] = useState("requests")

  if (detail?.pause) {
    return (
      <PauseForm
        tripId={detail.tripId}
        reason={detail.reason}
        onBack={() => onDetail(null)}
        onDone={() => { setTab("requests"); onDetail(null) }}
        onOpen={(ticketId) => onDetail({ ticketId })}
        onGeneral={(emergency) => onDetail({ compose: true, preset: emergency ? "emergency" : undefined })}
      />
    )
  }
  if (detail?.compose) {
    return (
      <SupportForm
        preset={detail.preset}
        onBack={() => onDetail(null)}
        onDone={() => onDetail(null)}
        onOpen={(id) => onDetail({ ticketId: id })}
      />
    )
  }
  if (detail?.ticketId) {
    return <SupportThread id={detail.ticketId} onBack={() => onDetail(null)} />
  }
  return (
    <SupportHub
      tab={tab}
      onTab={setTab}
      onBack={onBack}
      onCompose={() => onDetail({ compose: true })}
      onPause={(reason) => onDetail({ pause: true, reason: typeof reason === "string" ? reason : undefined })}
      onOpen={(id) => onDetail({ ticketId: id })}
    />
  )
}
