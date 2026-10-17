import { useDriverRealtime } from "./driverRealtime";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  currentDriverId, driverChatPhoto, driverDeleteChat, driverMarkRead, driverMessages, driverPodPhoto,
  driverSendMessage, driverSendPhoto,
} from "./driverApi";
import { onQueueChange, pending } from "./offlineQueue";
import { tap } from "./native";
import PhotoPick from "./PhotoPick";
import { PhotoViewer, useChatPhoto } from "../components/shared/chatPhoto";

/**
 * The driver's conversation with dispatch about one trip.
 *
 * Full screen, because a driver reads it standing at a gate with one hand
 * free, not squeezed under a map. Quick replies cover what is said most, so
 * most answers are one tap. A photo — a signed receipt, a fuel slip, damage to
 * the truck — goes the same way, with or without words.
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

const iconProps = {
  width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
  strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true,
};
const CameraIcon = () => (
  <svg {...iconProps}>
    <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
    <circle cx="12" cy="13" r="3.5" />
  </svg>
);
const ImageIcon = () => (
  <svg {...iconProps}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="m21 16-5-5-9 9" />
  </svg>
);

/** A picture still on this phone: just taken, or waiting in the outbox. */
function LocalPhoto({ blob }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!blob || typeof URL.createObjectURL !== "function") return undefined;
    const made = URL.createObjectURL(blob);
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [blob]);
  return url ? <img className="dr-chat-photo-img" src={url} alt="Photo being sent" /> : null;
}

/** A photo already stored on the server, opened full size on tap. */
function ThreadPhoto({ tripId, messageId, caption }) {
  const { ref, src, failed, retry } = useChatPhoto(() => driverChatPhoto(tripId, messageId), `${tripId}:${messageId}`);
  const [viewing, setViewing] = useState(false);
  const alt = caption ? `Photo: ${caption}` : "Photo";
  return (
    <div ref={ref} className="dr-chat-photo">
      {src ? (
        <button type="button" className="dr-chat-photo-btn" onClick={() => setViewing(true)} aria-label={`Open ${alt}`}>
          <img className="dr-chat-photo-img" src={src} alt={alt} />
        </button>
      ) : failed ? (
        <div className="dr-chat-photo-wait" role="alert">
          Photo could not be loaded.{" "}
          <button type="button" className="dr-chat-link" onClick={retry}>Try again</button>
        </div>
      ) : (
        <div className="dr-chat-photo-wait">Loading photo…</div>
      )}
      {viewing && src && <PhotoViewer src={src} alt={alt} onClose={() => setViewing(false)} />}
    </div>
  );
}

function CompletionPhoto({ tripId }) {
  const { ref, src, failed, retry } = useChatPhoto(() => driverPodPhoto(tripId), `driver-pod:${tripId}`);
  const [viewing, setViewing] = useState(false);
  return (
    <div ref={ref} className="dr-chat-complete-photo">
      {src ? (
        <button type="button" className="dr-chat-complete-photo-btn" onClick={() => setViewing(true)} aria-label="Open proof of delivery photo">
          <img src={src} alt="Proof of delivery" />
        </button>
      ) : failed ? (
        <div className="dr-chat-complete-photo-state" role="alert">
          Photo could not be loaded. <button type="button" className="dr-chat-link" onClick={retry}>Try again</button>
        </div>
      ) : (
        <div className="dr-chat-complete-photo-state">Loading delivery photo…</div>
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
    <section className="dr-chat-complete" aria-label="Completed trip details">
      <div className="dr-chat-complete-head">
        <span className="dr-chat-complete-mark" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16 9" />
          </svg>
        </span>
        <span><strong>Trip completed</strong><small>Your submitted delivery details</small></span>
        <span className="dr-chat-complete-state">{completion.state === "closed" ? "Closed" : "Done"}</span>
      </div>

      {completion.hasPhoto && <CompletionPhoto tripId={tripId} />}

      <dl className="dr-chat-complete-list">
        <div><dt>Name</dt><dd>{completion.receivedBy || "Not provided"}</dd></div>
        <div>
          <dt>Location</dt>
          <dd className="dr-chat-complete-location">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></svg>
            {location}
          </dd>
        </div>
        <div><dt>Confirmed</dt><dd>{confirmed}</dd></div>
        {completion.driverName && <div><dt>Driver</dt><dd>{completion.driverName}</dd></div>}
      </dl>

      {completion.note && <div className="dr-chat-complete-note"><span>Note</span><p>{completion.note}</p></div>}
    </section>
  );
}

export default function DriverChat({ tripId, ticketNo, onClose }) {
  const [messages, setMessages] = useState([]);
  const [completion, setCompletion] = useState(null);
  const [closed, setClosed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");
  const [sendErr, setSendErr] = useState("");
  const [sending, setSending] = useState([]); // { clientRef, body, file? } in flight
  const [waiting, setWaiting] = useState([]); // parked in the outbox
  const [draft, setDraft] = useState("");
  const [photo, setPhoto] = useState(null); // chosen, not yet sent
  const [trayOpen, setTrayOpen] = useState(false); // the camera / gallery choice
  const [deleting, setDeleting] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const lastIdRef = useRef(0);
  const readRef = useRef(0);
  const endRef = useRef(null);
  const path = `/trips/${tripId}/messages`;
  const photoPath = `${path}/photo`;

  const lastId = messages.length ? messages[messages.length - 1].id : 0;
  lastIdRef.current = lastId;

  const pull = useCallback(async (full = false) => {
    try {
      const data = await driverMessages(tripId, full ? 0 : lastIdRef.current);
      setMessages((cur) => (full ? data.messages : merge(cur, data.messages)));
      setCompletion(data.completion || null);
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
    const part = (r, key) => r.form?.find((p) => p.k === key);
    setWaiting(rows
      .filter((r) => (r.kind === "message" && r.path === path) || (r.kind === "photo" && r.path === photoPath))
      .map((r) => (r.kind === "photo"
        ? {
          clientRef: part(r, "clientRef")?.v || `q${r.id}`,
          body: part(r, "body")?.v || "",
          file: part(r, "photo")?.file?.blob || null,
        }
        : { clientRef: r.json?.clientRef || `q${r.id}`, body: r.json?.body || "" })));
  }, [path, photoPath]);

  // Dispatch wrote in this conversation: fetch it now rather than at the next poll.
  // Reading it marks it read (below), which clears it from the bell.
  useDriverRealtime((msg) => {
    if (msg?.type === "chat:message" && msg.channel === "trip" && msg.tripId === Number(tripId)) pull();
  });

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

  // A preview of the chosen photo. The object URL is the preview's to release.
  useEffect(() => {
    if (!photo || typeof URL.createObjectURL !== "function") { setPreviewUrl(null); return undefined; }
    const made = URL.createObjectURL(photo);
    setPreviewUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [photo]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages.length, sending.length, waiting.length, completion?.completedAt]);

  async function removeChat() {
    if (!window.confirm("Delete this chat from your view? The trip and delivery record will remain available.")) return;
    setDeleting(true);
    setLoadErr("");
    try {
      await driverDeleteChat(tripId);
      setMessages([]);
      setCompletion(null);
      setSending([]);
      setWaiting([]);
      onClose?.();
    } catch (e) {
      setLoadErr(e.message || "Could not delete this chat.");
    } finally {
      setDeleting(false);
    }
  }

  async function send(text) {
    const body = String(text ?? draft).trim();
    if (body.length > MAX) return;
    if (photo && text == null) return sendPhoto(body);
    if (!body) return;
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

  /** The chosen photo, with the draft as its caption. */
  async function sendPhoto(caption) {
    const file = photo;
    tap("light");
    setSendErr("");
    const clientRef = newRef();
    setSending((cur) => [...cur, { clientRef, body: caption, file }]);
    setPhoto(null);
    setDraft("");
    try {
      const out = await driverSendPhoto(tripId, file, caption, clientRef);
      if (out?.queued) await refreshWaiting();
      else if (out?.data) setMessages((cur) => merge(cur, [out.data]));
    } catch (e) {
      setSendErr(e.message || "Not sent.");
      // Give the picture and the words back rather than lose them.
      setPhoto(file);
      setDraft(caption);
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
        <button type="button" className="dr-chat-delete" onClick={removeChat} disabled={deleting} aria-label="Delete Chat">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 10v6M14 10v6" />
          </svg>
          <span>{deleting ? "Deleting…" : "Delete Chat"}</span>
        </button>
      </div>

      <div className="dr-chat-thread" role="log" aria-live="polite">
        {loading && <div className="dr-chat-empty">Loading…</div>}
        {!loading && loadErr && (
          <div className="dr-chat-empty">
            {loadErr}{" "}
            <button type="button" className="dr-chat-link" onClick={() => pull(true)}>Try again</button>
          </div>
        )}
        {!loading && !loadErr && messages.length === 0 && outgoing.length === 0 && !completion && (
          <div className="dr-chat-empty">
            No messages yet. Ask dispatch anything about this trip — they see it on their screen right away.
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`dr-chat-msg ${m.mine ? "mine" : ""}`}>
            {!m.mine && <div className="dr-chat-meta">{m.senderName}</div>}
            <div className={`dr-chat-bubble ${m.hasPhoto ? "has-photo" : ""}`}>
              {m.hasPhoto && <ThreadPhoto tripId={tripId} messageId={m.id} caption={m.body} />}
              {m.hasPhoto ? (m.body && <div className="dr-chat-caption">{m.body}</div>) : m.body}
            </div>
            <div className="dr-chat-time">{timeLabel(m.createdAt)}</div>
          </div>
        ))}
        {outgoing.map((o) => (
          <div key={o.clientRef} className="dr-chat-msg mine pending">
            <div className={`dr-chat-bubble ${o.file ? "has-photo" : ""}`}>
              {o.file && <div className="dr-chat-photo"><LocalPhoto blob={o.file} /></div>}
              {o.file ? (o.body && <div className="dr-chat-caption">{o.body}</div>) : o.body}
            </div>
            <div className="dr-chat-time">{o.note}</div>
          </div>
        ))}
        {completion && <CompletionCard tripId={tripId} completion={completion} />}
        <div ref={endRef} />
      </div>

      {closed ? (
        <div className="dr-chat-closed">This trip is closed. You can read the messages but not send new ones.</div>
      ) : (
        <form className="dr-chat-compose" onSubmit={(e) => { e.preventDefault(); send(); }}>
          {sendErr && <div className="dr-err tight" role="alert">{sendErr}</div>}
          {photo && (
            <div className="dr-chat-attach">
              {previewUrl && <img className="dr-chat-attach-img" src={previewUrl} alt="Photo ready to send" />}
              <span className="dr-chat-attach-note">Photo ready. Add a few words if you like, then send.</span>
              <button type="button" className="dr-chat-link" onClick={() => setPhoto(null)}>Remove</button>
            </div>
          )}
          <div className="dr-chat-quick">
            {QUICK.map((q) => (
              <button key={q} type="button" className="dr-chat-chip" onClick={() => send(q)}>{q}</button>
            ))}
          </div>
          {/* Opens only when asked, so the row stays as clean as any messaging app's.
              Closes once a photo is chosen — not before, or the picker would be
              unmounted while the phone's file dialog is still open. */}
          {trayOpen && (
            <div className="dr-chat-tray" role="group" aria-label="Attach a photo">
              <PhotoPick
                onFile={(file) => { setPhoto(file); setTrayOpen(false); }}
                className="dr-chat-tray-opt"
                takeLabel={<><CameraIcon /><span>Camera</span></>}
                pickLabel={<><ImageIcon /><span>Gallery</span></>}
              />
            </div>
          )}
          <div className="dr-chat-row">
            <button
              type="button"
              className={`dr-chat-plus ${trayOpen ? "open" : ""}`}
              aria-label="Attach a photo"
              aria-expanded={trayOpen}
              onClick={() => { tap("light"); setTrayOpen((v) => !v); }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
            <label htmlFor="dr-chat-input" className="dr-chat-sr">Message to dispatch</label>
            <textarea
              id="dr-chat-input"
              className="dr-input dr-chat-input"
              rows={1}
              maxLength={MAX}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={photo ? "Add a caption (optional)…" : "Message dispatch…"}
            />
            <button type="submit" className="dr-btn dr-chat-send" disabled={!photo && !draft.trim()}>Send</button>
          </div>
        </form>
      )}
    </div>
  );
}
