import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Camera, ClipboardCheck, Copy, LifeBuoy, MapPin, PauseCircle, PlayCircle, Send, X } from "lucide-react";
import { usePermissions } from "../../auth/permissions";
import { useToast } from "../shared/Toast";
import {
  approvePause,
  declinePause,
  getDriverReport,
  getDriverThread,
  getReportPhoto,
  replyToDriver,
  resumePause,
} from "../../services/operations/exceptionService";
import { getTrackingLink } from "../../services/operations/trackingService";
import "./driverReport.css";

const PAUSE_STATUS = {
  pending: { label: "Waiting for review", tone: "warn" },
  approved: { label: "Approved: delivery paused", tone: "info" },
  declined: { label: "Declined", tone: "danger" },
  resumed: { label: "Resumed", tone: "ok" },
  cancelled: { label: "Withdrawn", tone: "muted" },
};

const fmt = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

const minutesText = (m) => {
  if (m == null) return null;
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
};

/** One photograph. It needs the signed-in session to load, so it is fetched, not linked. */
function Evidence({ exceptionId, photo, onOpen }) {
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    getReportPhoto(exceptionId, photo.id)
      .then((url) => { if (live) setSrc(url); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [exceptionId, photo.id]);

  if (failed) return <div className="drp-photo drp-photo-missing">Photo unavailable</div>;
  if (!src) return <div className="drp-photo drp-photo-loading" aria-label="Loading photo" />;
  return (
    <button type="button" className="drp-photo" onClick={() => onOpen(src)} aria-label={`Open photo ${photo.id}`}>
      <img src={src} alt={`Evidence ${photo.id}`} />
    </button>
  );
}

/** The conversation with the driver, and the way to answer it. */
function Thread({ exceptionId, canReply, refreshKey }) {
  const { addToast } = useToast();
  const [thread, setThread] = useState(undefined);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const threadRef = useRef(null);

  const load = useCallback(
    () => getDriverThread(exceptionId).then(setThread).catch(() => setThread((t) => (t === undefined ? null : t))),
    [exceptionId],
  );
  useEffect(() => { load(); }, [load, refreshKey]);
  // Keep the newest message visible without scrolling the entire exception
  // dialog away from its summary and decision controls.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread?.messages?.length]);

  async function send(e) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setSending(true);
    try {
      await replyToDriver(exceptionId, body);
      setText("");
      await load();
    } catch (err) {
      addToast(err.message || "Could not send that.", "error");
    } finally {
      setSending(false);
    }
  }

  if (thread === undefined) return <div className="drp-muted">Loading the conversation…</div>;
  if (!thread) return null;
  const closed = thread.status === "closed";

  return (
    <section className="drp-section" aria-label="Conversation with the driver">
      <h4 className="drp-h">Conversation with {thread.driverName || "the driver"}</h4>
      {thread.messages.length === 0 ? (
        <div className="drp-muted">No messages yet.</div>
      ) : (
        <ul className="drp-thread" ref={threadRef}>
          {thread.messages.map((m) => (
            <li key={m.id} className="drp-msg" data-from={m.senderKind}>
              <div className="drp-msg-meta">{m.senderKind === "driver" ? m.senderName || "Driver" : m.senderName || "Office"} · {fmt(m.createdAt)}</div>
              <div className="drp-msg-body">{m.body}</div>
            </li>
          ))}
        </ul>
      )}
      {canReply && !closed && (
        <form className="drp-reply" onSubmit={send}>
          <label className="drp-sr" htmlFor={`drp-reply-${exceptionId}`}>Write to the driver</label>
          <textarea
            id={`drp-reply-${exceptionId}`}
            className="ops-form-input ops-form-textarea"
            rows={2}
            maxLength={2000}
            placeholder="Write to the driver. They see it in Help & Support."
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={sending}
          />
          <button type="submit" className="ops-btn ops-btn-secondary" disabled={sending || !text.trim()}>
            <Send size={13} /> {sending ? "Sending…" : "Send to driver"}
          </button>
        </form>
      )}
      {closed && <div className="drp-muted">This request is closed.</div>}
    </section>
  );
}

/** The link a customer can follow, made when asked for and copied for the dispatcher to send. */
function CustomerLink({ tripTicketId }) {
  const { addToast } = useToast();
  const [busy, setBusy] = useState(false);
  async function copy() {
    setBusy(true);
    try {
      const link = await getTrackingLink(tripTicketId);
      const url = `${window.location.origin}${link.path}`;
      try {
        await navigator.clipboard.writeText(url);
        addToast("Customer link copied.", "success");
      } catch {
        // no clipboard (an insecure page, or a refusal): show it to be copied by hand
        window.prompt("Copy this link for the customer:", url);
      }
    } catch (err) {
      addToast(err.message || "Could not make the link.", "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <button type="button" className="ops-btn ops-btn-ghost drp-link" onClick={copy} disabled={busy}>
      <Copy size={13} /> {busy ? "Making link…" : "Copy customer tracking link"}
    </button>
  );
}

/**
 * What the driver reported, inside the exception it created: the reason, their
 * words, the photographs, and — for a pause request — the decision, then the
 * resume. Everything the office does about it happens here, so the exception
 * and the delivery cannot disagree.
 */
export default function DriverReportPanel({ exception, onChanged }) {
  const { addToast } = useToast();
  const { can } = usePermissions();
  const [report, setReport] = useState(undefined);
  const [note, setNote] = useState("");
  const [customerMessage, setCustomerMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState(null);
  const [threadKey, setThreadKey] = useState(0);

  const id = exception.id;
  const filed = !!exception.sourceKind;
  const load = useCallback(
    () => (filed ? getDriverReport(id).then(setReport).catch(() => setReport((r) => (r === undefined ? null : r))) : Promise.resolve()),
    [id, filed],
  );
  // reloaded when the exception itself changes underneath (a realtime refresh, a decision elsewhere)
  useEffect(() => { load(); }, [load, exception.status, exception.resolvedAt]);

  if (!exception.sourceKind) return null;
  if (report === undefined) return <div className="drp-muted">Loading the driver's report…</div>;
  if (!report) return null;

  // A failed pre-trip inspection is read, and settled, where Fleet reviews them.
  if (report.kind === "inspection") {
    return (
      <div className="drp">
        <section className="drp-section" aria-label="Pre-trip inspection">
          <div className="drp-head">
            <h4 className="drp-h"><ClipboardCheck size={15} /> Pre-trip inspection</h4>
          </div>
          <p className="drp-muted">
            The driver&rsquo;s answers and photos are in Fleet → Inspections. Approving departure there, or marking the issue reviewed, settles this exception.
          </p>
          {can("inspection.read") && (
            <Link className="ops-btn ops-btn-secondary" to={`/fleet/inspections?open=${report.inspectionId}`}>
              Open the inspection
            </Link>
          )}
        </section>
      </div>
    );
  }

  const pause = report.kind === "pause" ? report.pause : null;
  const canDecide = can("exception.resolve");

  async function act(kind, fn) {
    setError("");
    setBusy(kind);
    try {
      const res = await fn();
      addToast(res?.message || "Done.", "success");
      setNote("");
      setCustomerMessage("");
      await load();
      setThreadKey((k) => k + 1);
      onChanged?.();
    } catch (err) {
      setError(err.message || "Could not do that.");
    } finally {
      setBusy("");
    }
  }

  const status = pause ? PAUSE_STATUS[pause.status] || { label: pause.statusLabel, tone: "muted" } : null;

  return (
    <div className="drp">
      <section className="drp-section" aria-label="Driver report">
        <div className="drp-head">
          <h4 className="drp-h">
            {pause ? <PauseCircle size={15} /> : <LifeBuoy size={15} />}
            {pause ? "Driver's pause request" : "Driver's concern"}
          </h4>
          {status && <span className="drp-chip" data-tone={status.tone}>{status.label}</span>}
        </div>

        {pause ? (
          <>
            <dl className="drp-facts">
              <div><dt>Reason</dt><dd>{pause.reasonLabel}</dd></div>
              <div><dt>Sent by driver at</dt><dd>{fmt(pause.requestedAt)}</dd></div>
              {pause.reviewedAt && <div><dt>{pause.status === "declined" ? "Declined" : "Approved"}</dt><dd>{fmt(pause.reviewedAt)}{pause.reviewedByName ? ` by ${pause.reviewedByName}` : ""}</dd></div>}
              {pause.resumedAt && <div><dt>Resumed</dt><dd>{fmt(pause.resumedAt)}{pause.resumedBy ? ` (${pause.resumedBy})` : ""}</dd></div>}
              {pause.pausedMinutes != null && <div><dt>Held for</dt><dd>{minutesText(pause.pausedMinutes)}{pause.status === "approved" ? " so far" : ""}</dd></div>}
              {pause.latitude != null && pause.longitude != null && (
                <div>
                  <dt>Where</dt>
                  <dd>
                    <a className="drp-map" href={`https://www.google.com/maps?q=${pause.latitude},${pause.longitude}`} target="_blank" rel="noreferrer noopener">
                      <MapPin size={12} /> {pause.latitude.toFixed(4)}, {pause.longitude.toFixed(4)}
                    </a>
                  </dd>
                </div>
              )}
            </dl>
            <p className="drp-quote">{pause.description}</p>

            <div className="drp-evidence">
              <div className="drp-sub"><Camera size={12} /> Evidence ({pause.photos.length})</div>
              {pause.photos.length === 0 ? (
                <div className="drp-muted">{pause.reason === "emergency" ? "No photos. They are optional in an emergency." : "No photos were attached."}</div>
              ) : (
                <div className="drp-photos">
                  {pause.photos.map((p) => <Evidence key={p.id} exceptionId={id} photo={p} onOpen={setZoom} />)}
                </div>
              )}
            </div>

            {pause.reviewNote && (
              <div className="drp-answer"><strong>Note to the driver:</strong> {pause.reviewNote}</div>
            )}
            {pause.customerMessage && (
              <div className="drp-answer"><strong>Shown to the customer:</strong> {pause.customerMessage}</div>
            )}

            {canDecide && pause.status === "pending" && (
              <div className="drp-decide">
                <label className="ops-form-label" htmlFor={`drp-note-${id}`}>
                  {pause.status === "pending" ? "Note to the driver" : "Note on resuming"}
                </label>
                <textarea
                  id={`drp-note-${id}`}
                  className="ops-form-input ops-form-textarea"
                  rows={2}
                  maxLength={500}
                  placeholder={pause.status === "pending" ? "Required to decline. Optional to approve." : "Optional. The driver sees it."}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  disabled={!!busy}
                />
                <label className="ops-form-label" htmlFor={`drp-cust-${id}`}>Message for the customer (optional)</label>
                <input
                  id={`drp-cust-${id}`}
                  className="ops-form-input"
                  maxLength={300}
                  placeholder="Shown on their tracking page next to the reason"
                  value={customerMessage}
                  onChange={(e) => setCustomerMessage(e.target.value)}
                  disabled={!!busy}
                />
                {error && <div className="drp-error" role="alert">{error}</div>}
                <div className="drp-actions">
                  {pause.status === "pending" ? (
                    <>
                      <button
                        type="button"
                        className="ops-btn ops-btn-primary"
                        disabled={!!busy}
                        onClick={() => act("approve", () => approvePause(id, { note, customerMessage }))}
                      >
                        <PauseCircle size={14} /> {busy === "approve" ? "Approving…" : "Approve pause"}
                      </button>
                      <button
                        type="button"
                        className="ops-btn ops-btn-danger"
                        disabled={!!busy || !note.trim()}
                        title={note.trim() ? undefined : "Write the driver a reason first"}
                        onClick={() => act("decline", () => declinePause(id, { note }))}
                      >
                        <X size={14} /> {busy === "decline" ? "Declining…" : "Decline"}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="ops-btn ops-btn-primary"
                      disabled={!!busy}
                      onClick={() => act("resume", () => resumePause(id, { note, customerMessage }))}
                    >
                      <PlayCircle size={14} /> {busy === "resume" ? "Resuming…" : "Resume delivery"}
                    </button>
                  )}
                </div>
              </div>
            )}

            {canDecide && pause.status === "approved" && (
              <div className="drp-decide drp-resume">
                <div className="drp-resume-row">
                  <div>
                    <strong>Ready to continue?</strong>
                    <span>This ends the pause and puts the delivery back on the road.</span>
                  </div>
                  <button
                    type="button"
                    className="ops-btn ops-btn-primary"
                    disabled={!!busy}
                    onClick={() => act("resume", () => resumePause(id, { note, customerMessage }))}
                  >
                    <PlayCircle size={14} /> {busy === "resume" ? "Resuming…" : "Resume delivery"}
                  </button>
                </div>
                <details className="drp-optional">
                  <summary>Add a message before resuming</summary>
                  <div className="drp-optional-fields">
                    <label className="ops-form-label" htmlFor={`drp-resume-note-${id}`}>Note to the driver (optional)</label>
                    <textarea
                      id={`drp-resume-note-${id}`}
                      className="ops-form-input ops-form-textarea"
                      rows={2}
                      maxLength={500}
                      placeholder="The driver sees this message."
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      disabled={!!busy}
                    />
                    <label className="ops-form-label" htmlFor={`drp-resume-cust-${id}`}>Message for the customer (optional)</label>
                    <input
                      id={`drp-resume-cust-${id}`}
                      className="ops-form-input"
                      maxLength={300}
                      placeholder="Shown on the customer tracking page."
                      value={customerMessage}
                      onChange={(e) => setCustomerMessage(e.target.value)}
                      disabled={!!busy}
                    />
                  </div>
                </details>
                {error && <div className="drp-error" role="alert">{error}</div>}
              </div>
            )}
          </>
        ) : (
          <dl className="drp-facts">
            <div><dt>Request</dt><dd>{report.ticket.ticketNo}</dd></div>
            <div><dt>Topic</dt><dd>{report.ticket.category}</dd></div>
            <div><dt>Priority</dt><dd>{report.ticket.priority}</dd></div>
            <div><dt>Handled by</dt><dd>{report.ticket.assignedName || "Nobody yet"}</dd></div>
            <div><dt>Subject</dt><dd>{report.ticket.subject}</dd></div>
          </dl>
        )}

        {exception.tripTicketId && can("tracking.share") && <CustomerLink tripTicketId={exception.tripTicketId} />}
      </section>

      {can("support.read") && <Thread exceptionId={id} canReply={can("support.manage")} refreshKey={threadKey} />}

      {zoom && (
        <div className="drp-zoom" role="dialog" aria-label="Photo" onClick={() => setZoom(null)}>
          <img src={zoom} alt="Evidence, enlarged" />
          <button type="button" className="ops-btn ops-btn-secondary drp-zoom-close" onClick={() => setZoom(null)}>
            <X size={14} /> Close
          </button>
        </div>
      )}
    </div>
  );
}
