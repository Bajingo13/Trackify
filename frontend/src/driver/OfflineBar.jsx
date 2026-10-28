import { useCallback, useEffect, useRef, useState } from "react";
import { dismissRefused, isOnline, onQueueChange, pendingCount, refusedWork } from "./offlineQueue";
import { currentDriverId, flushOutbox } from "./driverApi";
import { useNetStatus } from "./netStatus";
import NetSign from "./NetSign";

const RETRY_INITIAL_MS = 5000;
const RETRY_MAX_MS = 60000;
const EMPTY_QUEUE = { total: 0, pings: 0, trail: 0, records: 0 };

/* The queue's kinds, in the driver's words. */
const KIND_LABEL = {
  deliver: "delivery",
  expense: "expense",
  start: "trip start",
  stop: "stop arrival",
  message: "message",
  support: "support request",
  "support-reply": "support reply",
  pause: "pause request",
  inspection: "pre-trip inspection",
  odometer: "odometer reading",
};
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const formatTime = (ms) =>
  new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * Tells the driver the truth about their connection.
 *
 * "No Connection" comes from netStatus, which only calls the app
 * online again once the server has actually answered, so the bar stays until
 * the internet is really back and cannot be dismissed. The outbox retry timer
 * also keeps working after a server-only outage, while exponential backoff
 * avoids holding the radio open and draining the battery during a long failure.
 */
export default function OfflineBar() {
  const ownerId = currentDriverId();
  const online = useNetStatus() !== "offline";
  const [queue, setQueue] = useState(EMPTY_QUEUE);
  const [refused, setRefused] = useState(() => refusedWork(ownerId));
  const [sending, setSending] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const sendingRef = useRef(false);
  const retryDelayRef = useRef(RETRY_INITIAL_MS);

  const refresh = useCallback(async () => {
    setRefused(refusedWork(ownerId));
    try {
      const next = await pendingCount(ownerId);
      setQueue(next);
      return next;
    } catch {
      return EMPTY_QUEUE;
    }
  }, [ownerId]);

  const sendSaved = useCallback(async ({ advanceBackoff = false } = {}) => {
    if (!isOnline() || sendingRef.current) return;
    const before = await pendingCount(ownerId).catch(() => EMPTY_QUEUE);
    if (before.total === 0) return;

    sendingRef.current = true;
    setSending(true);
    try {
      await flushOutbox();
    } catch {
      // The rows remain in IndexedDB and the bounded timer will try again.
    } finally {
      sendingRef.current = false;
      setSending(false);
      const after = await refresh();
      if (after.total === 0 || after.total < before.total) {
        retryDelayRef.current = RETRY_INITIAL_MS;
      } else if (advanceBackoff) {
        retryDelayRef.current = Math.min(retryDelayRef.current * 2, RETRY_MAX_MS);
        setRetryTick((value) => value + 1);
      }
    }
  }, [ownerId, refresh]);

  useEffect(() => {
    let active = true;
    const off = onQueueChange(refresh);

    // Catch work left by a previous session. A new queued item also triggers
    // refresh through onQueueChange and enters the bounded retry effect below.
    refresh().then((next) => {
      if (active && isOnline() && next.total > 0) void sendSaved();
    });

    return () => {
      active = false;
      off();
    };
  }, [refresh, sendSaved]);

  // Back online, confirmed by the server: send what was saved, straight away.
  const wasOnline = useRef(online);
  useEffect(() => {
    if (online && !wasOnline.current) {
      retryDelayRef.current = RETRY_INITIAL_MS;
      void sendSaved();
    }
    wasOnline.current = online;
  }, [online, sendSaved]);

  useEffect(() => {
    if (!online || sending || queue.total === 0) return undefined;
    const timer = window.setTimeout(
      () => void sendSaved({ advanceBackoff: true }),
      retryDelayRef.current,
    );
    return () => window.clearTimeout(timer);
  }, [online, queue.total, sending, retryTick, sendSaved]);

  // What was refused, kept while its sign fades out after OK.
  const lastRefused = useRef(refused);
  if (refused.length > 0) lastRefused.current = refused;
  const shownRefused = refused.length > 0 ? refused : lastRefused.current;

  const retry = async () => {
    retryDelayRef.current = RETRY_INITIAL_MS;
    await sendSaved();
  };

  const savedSummary = [
    queue.records > 0
      ? `${queue.records} work ${queue.records === 1 ? "item" : "items"}`
      : null,
    // The trail is the full record of the road; the live pings are its last few
    // minutes, the same readings again, so they are not counted on top.
    queue.trail > 0
      ? `${queue.trail} route ${queue.trail === 1 ? "point" : "points"}`
      : queue.pings > 0
        ? `${queue.pings} location ${queue.pings === 1 ? "update" : "updates"}`
        : null,
  ].filter(Boolean).join(" and ");

  return (
    <>
      <NetSign
        show={refused.length > 0}
        tone="danger"
        icon="alert"
        role="alert"
        label={shownRefused.length === 1 ? "Not accepted" : `${shownRefused.length} not accepted`}
        action={{ label: "OK", onClick: () => dismissRefused(ownerId) }}
        detail={
          <>
            {shownRefused.map((item, i) => (
              <div key={`${item.queuedAt}-${i}`}>
                {`${capitalize(KIND_LABEL[item.kind] || "update")}${item.queuedAt ? ` saved ${formatTime(item.queuedAt)}` : ""}: `}
                {item.reason}
              </div>
            ))}
            <div>
              {shownRefused.length === 1 ? "It was not filed. Enter it again" : "They were not filed. Enter them again"}, or tell the office.
            </div>
          </>
        }
      />
      <NetSign
        show={!online}
        tone="warn"
        icon="wifiOff"
        label="No Connection"
        minimizable
        detail={
          <>
            <div>No internet connection. Your route still works.</div>
            <div>Messages, requests and claims for the office need the internet.</div>
            {queue.total > 0 && <div>{savedSummary} saved on this phone, sent when you are back online.</div>}
          </>
        }
      />
      <NetSign
        show={online && (queue.total > 0 || sending)}
        tone="info"
        icon="upload"
        label={sending ? "Sending…" : "Waiting to send"}
        minimizable
        action={!sending && queue.total > 0 ? { label: "Send now", onClick: retry } : undefined}
        detail={queue.total > 0 ? `${savedSummary} saved on this phone.` : "Everything is sent."}
      />
    </>
  );
}
