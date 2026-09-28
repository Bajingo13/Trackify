import { useCallback, useEffect, useRef, useState } from "react";
import { Phone, Send, RotateCcw } from "lucide-react";
import { Drawer } from "../ui";
import { usePermissions } from "../../auth/permissions";
import { useRealtime } from "../../services/realtime";
import { getThread, markRead, newClientRef, sendMessage } from "../../services/operations/chatService";
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

export default function TripChat({ trip, open, onClose, onRead, driverPhone }) {
  const { canAny } = usePermissions();
  const canSend = canAny(SEND_ANY);
  const tripId = trip?.id;

  const [messages, setMessages] = useState([]);
  const [pending, setPending] = useState([]); // { clientRef, body, failed, error }
  const [closed, setClosed] = useState(false);
  const [hasDriver, setHasDriver] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [draft, setDraft] = useState("");
  const endRef = useRef(null);
  const lastIdRef = useRef(0);
  const readIdRef = useRef(0);

  const lastId = messages.length ? messages[messages.length - 1].id : 0;
  lastIdRef.current = lastId;

  // Reset when the drawer moves to another trip.
  useEffect(() => {
    setMessages([]);
    setPending([]);
    setDraft("");
    setLoadError("");
    setLoading(true);
    readIdRef.current = 0;
  }, [tripId]);

  const pull = useCallback(async ({ full = false } = {}) => {
    if (!tripId) return;
    try {
      const data = await getThread(tripId, full ? 0 : lastIdRef.current);
      setMessages((cur) => (full ? data.messages : merge(cur, data.messages)));
      setClosed(Boolean(data.closed));
      setHasDriver(Boolean(data.driver));
      setLoadError("");
    } catch (err) {
      if (full) setLoadError(err.message || "Could not load the conversation.");
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    if (!open || !tripId) return undefined;
    pull({ full: true });
    const id = setInterval(() => pull(), POLL_MS);
    return () => clearInterval(id);
  }, [open, tripId, pull]);

  useRealtime((msg) => {
    if (msg?.type !== "trip:message" || msg.tripId !== tripId || !msg.message) return;
    setMessages((cur) => merge(cur, [{ ...msg.message, mine: false, ...(cur.find((m) => m.id === msg.message.id) || {}) }]));
    // It came back to the sender too; the optimistic copy is no longer needed.
    if (msg.message.clientRef) setPending((cur) => cur.filter((p) => p.clientRef !== msg.message.clientRef));
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
  }, [messages.length, pending.length, open]);

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
          rows={2}
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
        </div>
        {driverPhone && (
          <a className="ops-btn ops-btn-secondary tc-call" href={`tel:${driverPhone}`}>
            <Phone size={13} /> Call
          </a>
        )}
      </div>

      <div className="tc-thread" role="log" aria-live="polite" aria-label="Conversation">
        {loading && <div className="tc-empty">Loading conversation…</div>}
        {!loading && loadError && (
          <div className="tc-empty" role="alert">
            {loadError}{" "}
            <button type="button" className="tc-link" onClick={() => pull({ full: true })}>Try again</button>
          </div>
        )}
        {!loading && !loadError && messages.length === 0 && pending.length === 0 && (
          <div className="tc-empty">
            {closed
              ? "No messages were exchanged about this trip."
              : "No messages yet. What you send appears on the driver's phone in the Trackify Driver app."}
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`tc-msg ${m.mine ? "is-mine" : ""} ${m.senderKind === "driver" ? "is-driver" : ""}`}>
            {!m.mine && <div className="tc-meta">{m.senderName}{m.senderKind === "staff" ? " · Dispatch" : ""}</div>}
            <div className="tc-bubble">{m.body}</div>
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
        <div ref={endRef} />
      </div>
    </Drawer>
  );
}
