import { useCallback, useEffect, useRef, useState } from "react";
import { currentDriverId, driverMarkRead, driverMessages, driverSendMessage } from "./driverApi";
import { onQueueChange, pending } from "./offlineQueue";
import { tap } from "./native";

/**
 * The driver's conversation with dispatch about one trip.
 *
 * Full screen, because a driver reads it standing at a gate with one hand
 * free, not squeezed under a map. Quick replies cover what is said most, so
 * most answers are one tap.
 *
 * There is no live socket on the phone, so an open conversation asks for
 * anything new every few seconds and stops when it is closed. Out of signal a
 * message goes into the phone's outbox like any other record and is shown
 * here as waiting until it is sent.
 */

const POLL_MS = 5000;
const MAX = 1000;
const QUICK = ["Nasa pickup na po.", "Nasa gate na po.", "Traffic po, medyo late.", "Na-deliver na po."];

const newRef = () =>
  (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

function timeLabel(value) {
  const d = new Date(value);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function merge(current, incoming) {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

export default function DriverChat({ tripId, ticketNo, onClose }) {
  const [messages, setMessages] = useState([]);
  const [closed, setClosed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");
  const [sendErr, setSendErr] = useState("");
  const [sending, setSending] = useState([]); // { clientRef, body } in flight
  const [waiting, setWaiting] = useState([]); // parked in the outbox
  const [draft, setDraft] = useState("");
  const lastIdRef = useRef(0);
  const readRef = useRef(0);
  const endRef = useRef(null);
  const path = `/trips/${tripId}/messages`;

  const lastId = messages.length ? messages[messages.length - 1].id : 0;
  lastIdRef.current = lastId;

  const pull = useCallback(async (full = false) => {
    try {
      const data = await driverMessages(tripId, full ? 0 : lastIdRef.current);
      setMessages((cur) => (full ? data.messages : merge(cur, data.messages)));
      setClosed(Boolean(data.closed));
      setLoadErr("");
    } catch (e) {
      if (full) setLoadErr(e.message || "Could not load the messages.");
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  // What is sitting in the outbox for this conversation.
  const refreshWaiting = useCallback(async () => {
    const rows = await pending(currentDriverId());
    setWaiting(rows
      .filter((r) => r.kind === "message" && r.path === path)
      .map((r) => ({ clientRef: r.json?.clientRef || `q${r.id}`, body: r.json?.body || "" })));
  }, [path]);

  useEffect(() => {
    pull(true);
    refreshWaiting();
    const id = window.setInterval(() => pull(), POLL_MS);
    const off = onQueueChange(() => { refreshWaiting(); pull(); });
    const onVisible = () => { if (document.visibilityState === "visible") pull(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      off();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pull, refreshWaiting]);

  useEffect(() => {
    if (!lastId || lastId <= readRef.current) return;
    readRef.current = lastId;
    driverMarkRead(tripId, lastId).catch(() => {});
  }, [tripId, lastId]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages.length, sending.length, waiting.length]);

  async function send(text) {
    const body = String(text ?? draft).trim();
    if (!body || body.length > MAX) return;
    tap("light");
    setSendErr("");
    const clientRef = newRef();
    setSending((cur) => [...cur, { clientRef, body }]);
    if (text == null) setDraft("");
    try {
      const out = await driverSendMessage(tripId, body, clientRef);
      if (out?.queued) await refreshWaiting();
      else if (out?.data) setMessages((cur) => merge(cur, [out.data]));
    } catch (e) {
      setSendErr(e.message || "Not sent.");
      if (text == null) setDraft(body); // give the words back rather than lose them
      if (e.status === 409) pull(true);
    } finally {
      setSending((cur) => cur.filter((s) => s.clientRef !== clientRef));
    }
  }

  // A message already stored should not also show as waiting.
  const stored = new Set(messages.map((m) => m.clientRef).filter(Boolean));
  const outgoing = [
    ...sending.map((s) => ({ ...s, note: "Sending…" })),
    ...waiting.filter((w) => !stored.has(w.clientRef)).map((w) => ({ ...w, note: "Waiting for signal — sends automatically" })),
  ];

  return (
    <div className="dr-chat" role="dialog" aria-modal="true" aria-label={`Chat with dispatch about ${ticketNo}`}>
      <div className="dr-chat-head">
        <button className="dr-back" onClick={onClose} aria-label="Close chat">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <span className="dr-detail-title">
          <span className="dr-detail-no">Dispatch</span>
          <span className="dr-detail-sub">{ticketNo}</span>
        </span>
      </div>

      <div className="dr-chat-thread" role="log" aria-live="polite">
        {loading && <div className="dr-chat-empty">Loading…</div>}
        {!loading && loadErr && (
          <div className="dr-chat-empty">
            {loadErr}{" "}
            <button type="button" className="dr-chat-link" onClick={() => pull(true)}>Try again</button>
          </div>
        )}
        {!loading && !loadErr && messages.length === 0 && outgoing.length === 0 && (
          <div className="dr-chat-empty">
            No messages yet. Ask dispatch anything about this trip — they see it on their screen right away.
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`dr-chat-msg ${m.mine ? "mine" : ""}`}>
            {!m.mine && <div className="dr-chat-meta">{m.senderName}</div>}
            <div className="dr-chat-bubble">{m.body}</div>
            <div className="dr-chat-time">{timeLabel(m.createdAt)}</div>
          </div>
        ))}
        {outgoing.map((o) => (
          <div key={o.clientRef} className="dr-chat-msg mine pending">
            <div className="dr-chat-bubble">{o.body}</div>
            <div className="dr-chat-time">{o.note}</div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {closed ? (
        <div className="dr-chat-closed">This trip is closed. You can read the messages but not send new ones.</div>
      ) : (
        <form className="dr-chat-compose" onSubmit={(e) => { e.preventDefault(); send(); }}>
          {sendErr && <div className="dr-err tight" role="alert">{sendErr}</div>}
          <div className="dr-chat-quick">
            {QUICK.map((q) => (
              <button key={q} type="button" className="dr-chat-chip" onClick={() => send(q)}>{q}</button>
            ))}
          </div>
          <div className="dr-chat-row">
            <label htmlFor="dr-chat-input" className="dr-chat-sr">Message to dispatch</label>
            <textarea
              id="dr-chat-input"
              className="dr-input dr-chat-input"
              rows={1}
              maxLength={MAX}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Message dispatch…"
            />
            <button type="submit" className="dr-btn dr-chat-send" disabled={!draft.trim()}>Send</button>
          </div>
        </form>
      )}
    </div>
  );
}
