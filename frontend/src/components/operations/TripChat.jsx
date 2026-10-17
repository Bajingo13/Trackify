import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, MapPin, Phone, Send, RotateCcw, Trash2 } from "lucide-react";
import { Drawer } from "../ui";
import { usePermissions } from "../../auth/permissions";
import { useRealtime } from "../../services/realtime";
import {
  deleteChat, getCompletionPhoto, getPhoto, getThread, markRead, newClientRef, sendMessage, setOpenChat,
} from "../../services/operations/chatService";
import { PhotoViewer, useChatPhoto } from "../shared/chatPhoto";
import "./tripChat.css";

/**
 * Chat with the driver on one trip.
 *
 * New messages arrive over the realtime socket; a slow poll covers the times
 * it is down. A message being sent shows at once and is marked if it fails,
 * with a retry that reuses its id so the server never stores it twice.
 *
 * Read-only for anyone who may watch the trip but not run it, and for a trip
 * that is closed.
 */

const SEND_ANY = ["tracking.update", "trip.assign", "trip.release"];
const QUICK = ["Noted, salamat po.", "Tatawagan kita.", "Ingat sa biyahe."];
const POLL_MS = 15000;
const MAX = 1000;

function timeLabel(value) {
  const d = new Date(value);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Merge by id, oldest first. */
function merge(current, incoming) {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, { ...byId.get(m.id), ...m });
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

/** A photo the driver sent, shown in the thread and opened full size on click. */
function ThreadPhoto({ tripId, messageId, caption }) {
  const { ref, src, failed, retry } = useChatPhoto(() => getPhoto(tripId, messageId), `${tripId}:${messageId}`);
  const [viewing, setViewing] = useState(false);
  const alt = caption ? `Photo: ${caption}` : "Photo from the driver";

  return (
    <div ref={ref} className="tc-photo">
      {src ? (
        <button type="button" className="tc-photo-btn" onClick={() => setViewing(true)} aria-label={`Open ${alt}`}>
          <img src={src} alt={alt} className="tc-photo-img" />
        </button>
      ) : failed ? (
        <div className="tc-photo-wait" role="alert">
          Photo could not be loaded.{" "}
          <button type="button" className="tc-link" onClick={retry}><RotateCcw size={11} /> Retry</button>
        </div>
      ) : (
        <div className="tc-photo-wait">Loading photo…</div>
      )}
      {viewing && src && <PhotoViewer src={src} alt={alt} onClose={() => setViewing(false)} />}
    </div>
  );
}

function CompletionPhoto({ tripId }) {
  const { ref, src, failed, retry } = useChatPhoto(() => getCompletionPhoto(tripId), `pod:${tripId}`);
  const [viewing, setViewing] = useState(false);
  return (
    <div ref={ref} className="tc-complete-photo">
      {src ? (
        <button type="button" className="tc-complete-photo-btn" onClick={() => setViewing(true)} aria-label="Open proof of delivery photo">
          <img src={src} alt="Proof of delivery" />
        </button>
      ) : failed ? (
        <div className="tc-complete-photo-state" role="alert">
          Photo could not be loaded. <button type="button" className="tc-link" onClick={retry}>Retry</button>
        </div>
      ) : (
        <div className="tc-complete-photo-state">Loading delivery photo…</div>
      )}
      {viewing && src && <PhotoViewer src={src} alt="Proof of delivery" onClose={() => setViewing(false)} />}
    </div>
  );
}

function CompletionCard({ tripId, completion }) {
  const hasLocation = completion.lat != null && completion.lng != null;
  const location = hasLocation ? `${completion.lat.toFixed(5)}, ${completion.lng.toFixed(5)}` : "Not captured";
  const confirmed = completion.confirmedAt
    ? new Date(completion.confirmedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
    : "Not recorded";

  return (
    <section className="tc-complete" aria-label="Completed trip details">
      <div className="tc-complete-head">
        <span className="tc-complete-icon"><CheckCircle2 size={18} /></span>
        <span>
          <strong>Trip completed</strong>
          <small>Delivery details submitted from the completion form</small>
        </span>
        <span className="tc-complete-state">{completion.state === "closed" ? "Closed" : "Done"}</span>
      </div>

      {completion.hasPhoto && <CompletionPhoto tripId={tripId} />}

      <dl className="tc-complete-list">
        <div><dt>Name</dt><dd>{completion.receivedBy || "Not provided"}</dd></div>
        <div>
          <dt>Location</dt>
          <dd className="tc-complete-location"><MapPin size={13} /> {location}</dd>
        </div>
        <div><dt>Confirmed</dt><dd>{confirmed}</dd></div>
        {completion.driverName && <div><dt>Driver</dt><dd>{completion.driverName}</dd></div>}
      </dl>

      {completion.note && (
        <div className="tc-complete-note"><span>Note</span><p>{completion.note}</p></div>
      )}
    </section>
  );
}

export default function TripChat({ trip, open, onClose, onRead, driverPhone }) {
  const { canAny } = usePermissions();
  const canSend = canAny(SEND_ANY);
  const tripId = trip?.id;

  const [messages, setMessages] = useState([]);
  const [pending, setPending] = useState([]); // { clientRef, body, failed, error }
  const [completion, setCompletion] = useState(null);
  const [closed, setClosed] = useState(false);
  const [hasDriver, setHasDriver] = useState(true);
  // undefined until the thread has loaded, so "no number" is never shown on a guess
  const [threadPhone, setThreadPhone] = useState(undefined);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [draft, setDraft] = useState("");
  const [deleting, setDeleting] = useState(false);
  const endRef = useRef(null);
  const lastIdRef = useRef(0);
  const readIdRef = useRef(0);

  const lastId = messages.length ? messages[messages.length - 1].id : 0;
  lastIdRef.current = lastId;

  // Reset when the drawer moves to another trip.
  useEffect(() => {
    setMessages([]);
    setPending([]);
    setCompletion(null);
    setDraft("");
    setLoadError("");
    setLoading(true);
    setThreadPhone(undefined);
    readIdRef.current = 0;
  }, [tripId]);

  const pull = useCallback(async ({ full = false } = {}) => {
    if (!tripId) return;
    try {
      const data = await getThread(tripId, full ? 0 : lastIdRef.current);
      setMessages((cur) => (full ? data.messages : merge(cur, data.messages)));
      setCompletion(data.completion || null);
      setClosed(Boolean(data.closed));
      setHasDriver(Boolean(data.driver));
      setThreadPhone(data.driver?.phone || null);
      setLoadError("");
    } catch (err) {
      if (full) setLoadError(err.message || "Could not load the conversation.");
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  // Tell the top bar this thread is being read, so it does not pop up about it.
  useEffect(() => {
    if (!open || !tripId) return undefined;
    setOpenChat(Number(tripId));
    return () => setOpenChat(null);
  }, [open, tripId]);

  useEffect(() => {
    if (!open || !tripId) return undefined;
    pull({ full: true });
    const id = setInterval(() => pull(), POLL_MS);
    return () => clearInterval(id);
  }, [open, tripId, pull]);

  useRealtime((msg) => {
    if (msg?.tripId !== tripId) return;
    if (msg.type === "trip:status" && ["delivered", "operationally_closed"].includes(msg.status)) {
      pull({ full: true });
      return;
    }
    if (msg.type === "trip:message" && msg.message) {
      setMessages((cur) => merge(cur, [{ ...msg.message, mine: false, ...(cur.find((m) => m.id === msg.message.id) || {}) }]));
      // It came back to the sender too; the optimistic copy is no longer needed.
      if (msg.message.clientRef) setPending((cur) => cur.filter((p) => p.clientRef !== msg.message.clientRef));
    }
  });

  // Seen while open means read.
  useEffect(() => {
    if (!open || !tripId || !lastId || lastId <= readIdRef.current) return;
    readIdRef.current = lastId;
    markRead(tripId, lastId).catch(() => {});
    onRead?.(tripId);
  }, [open, tripId, lastId, onRead]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages.length, pending.length, completion?.completedAt, open]);

  async function removeChat() {
    if (!window.confirm("Delete this chat from your view? The trip and delivery record will remain available.")) return;
    setDeleting(true);
    setLoadError("");
    try {
      await deleteChat(tripId);
      setMessages([]);
      setPending([]);
      setCompletion(null);
      onRead?.(tripId);
      onClose?.();
    } catch (err) {
      setLoadError(err.message || "Could not delete this chat.");
    } finally {
      setDeleting(false);
    }
  }

  async function deliver(body, clientRef) {
    try {
      const saved = await sendMessage(tripId, body, clientRef);
      setMessages((cur) => merge(cur, [saved]));
      setPending((cur) => cur.filter((p) => p.clientRef !== clientRef));
    } catch (err) {
      setPending((cur) => cur.map((p) => (p.clientRef === clientRef
        ? { ...p, failed: true, error: err.message || "Not sent." }
        : p)));
      if (err.status === 409) pull({ full: true });
    }
  }

  function send(text) {
    const body = String(text ?? draft).trim();
    if (!body || body.length > MAX) return;
    const clientRef = newClientRef();
    setPending((cur) => [...cur, { clientRef, body, failed: false }]);
    if (text == null) setDraft("");
    deliver(body, clientRef);
  }

  function retry(p) {
    setPending((cur) => cur.map((x) => (x.clientRef === p.clientRef ? { ...x, failed: false, error: "" } : x)));
    deliver(p.body, p.clientRef);
  }

  const writable = canSend && !closed && hasDriver;
  const readOnlyReason = !hasDriver
    ? "No driver is assigned to this trip yet."
    : closed
      ? "This trip is closed. Its conversation is kept here as a record."
      : !canSend
        ? "You can read this conversation but not reply."
        : "";

  const composer = writable ? (
    <form
      className="tc-composer"
      onSubmit={(e) => { e.preventDefault(); send(); }}
    >
      <div className="tc-quick">
        {QUICK.map((q) => (
          <button key={q} type="button" className="tc-chip" onClick={() => send(q)}>{q}</button>
        ))}
      </div>
      <div className="tc-input-row">
        <label htmlFor="trip-chat-input" className="tc-sr">Message to {trip?.driver || "the driver"}</label>
        <textarea
          id="trip-chat-input"
          className="tc-input"
          rows={1}
          value={draft}
          maxLength={MAX}
          placeholder={`Message ${trip?.driver || "the driver"}…`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
          }}
        />
        <button type="submit" className="ops-btn ops-btn-primary tc-send" disabled={!draft.trim()} aria-label="Send">
          <Send size={15} />
        </button>
      </div>
      {draft.length > MAX - 100 && <div className="tc-count">{draft.length} / {MAX}</div>}
    </form>
  ) : (
    <div className="tc-readonly">{readOnlyReason}</div>
  );

  // the screen's own copy of the number if it passed one, else the thread's
  const phone = driverPhone || threadPhone || null;
  const phoneKnown = Boolean(phone) || threadPhone !== undefined;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={420}
      title={trip ? `Chat · ${trip.ticketNo}` : "Chat"}
      footer={composer}
    >
      <div className="tc-head">
        <div>
          <div className="tc-driver">{trip?.driver || "No driver assigned"}</div>
          <div className="tc-sub">{trip ? `${trip.origin} → ${trip.destination}` : ""}</div>
          {/* the number the Call button dials, so it can also be read out or typed */}
          {trip?.driver && phoneKnown && (
            <div className="tc-sub tc-phone">{phone || "No phone number on file"}</div>
          )}
        </div>
        <div className="tc-head-actions">
          {trip?.driver && phoneKnown && (
            <a
              className={`ops-btn ops-btn-secondary tc-call ${phone ? "" : "is-disabled"}`}
              href={phone ? `tel:${phone}` : undefined}
              aria-disabled={!phone}
              title={phone ? `Call ${trip.driver}` : "No phone number on this driver's record"}
            >
              <Phone size={13} /> Call
            </a>
          )}
          <button type="button" className="tc-delete" onClick={removeChat} disabled={deleting}>
            <Trash2 size={13} /> {deleting ? "Deleting…" : "Delete Chat"}
          </button>
        </div>
      </div>

      <div className="tc-thread" role="log" aria-live="polite" aria-label="Conversation">
        {loading && <div className="tc-empty">Loading conversation…</div>}
        {!loading && loadError && (
          <div className="tc-empty" role="alert">
            {loadError}{" "}
            <button type="button" className="tc-link" onClick={() => pull({ full: true })}>Try again</button>
          </div>
        )}
        {!loading && !loadError && messages.length === 0 && pending.length === 0 && !completion && (
          <div className="tc-empty">
            {closed
              ? "No messages were exchanged about this trip."
              : "No messages yet. What you send appears on the driver's phone in the Trackify Driver app."}
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`tc-msg ${m.mine ? "is-mine" : ""} ${m.senderKind === "driver" ? "is-driver" : ""}`}>
            {!m.mine && <div className="tc-meta">{m.senderName}{m.senderKind === "staff" ? " · Dispatch" : ""}</div>}
            <div className={`tc-bubble ${m.hasPhoto ? "has-photo" : ""}`}>
              {m.hasPhoto && <ThreadPhoto tripId={tripId} messageId={m.id} caption={m.body} />}
              {m.hasPhoto ? (m.body && <div className="tc-caption">{m.body}</div>) : m.body}
            </div>
            <div className="tc-time">{timeLabel(m.createdAt)}</div>
          </div>
        ))}
        {pending.map((p) => (
          <div key={p.clientRef} className={`tc-msg is-mine ${p.failed ? "is-failed" : "is-pending"}`}>
            <div className="tc-bubble">{p.body}</div>
            <div className="tc-time">
              {p.failed ? (
                <>
                  {p.error || "Not sent."}{" "}
                  <button type="button" className="tc-link" onClick={() => retry(p)}>
                    <RotateCcw size={11} /> Retry
                  </button>
                </>
              ) : "Sending…"}
            </div>
          </div>
        ))}
        {completion && <CompletionCard tripId={tripId} completion={completion} />}
        <div ref={endRef} />
      </div>
    </Drawer>
  );
}
