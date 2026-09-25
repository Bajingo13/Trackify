import { useCallback, useEffect, useRef, useState } from "react";
import { isOnline, onQueueChange, pendingCount } from "./offlineQueue";
import { currentDriverId, flushOutbox } from "./driverApi";

const RETRY_INITIAL_MS = 5000;
const RETRY_MAX_MS = 60000;
const EMPTY_QUEUE = { total: 0, pings: 0, records: 0 };

/**
 * Tells the driver the truth about their connection.
 *
 * navigator.onLine only knows whether the phone has a network, not whether
 * the API is reachable. The retry timer therefore keeps working after a
 * server-only outage, while exponential backoff avoids holding the radio open
 * and draining the battery during a long failure.
 */
export default function OfflineBar() {
  const ownerId = currentDriverId();
  const [online, setOnline] = useState(isOnline());
  const [queue, setQueue] = useState(EMPTY_QUEUE);
  const [sending, setSending] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const sendingRef = useRef(false);
  const retryDelayRef = useRef(RETRY_INITIAL_MS);

  const refresh = useCallback(async () => {
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

    const goOnline = () => {
      setOnline(true);
      retryDelayRef.current = RETRY_INITIAL_MS;
      void sendSaved();
    };
    const goOffline = () => setOnline(false);

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);

    // Catch work left by a previous session. A new queued item also triggers
    // refresh through onQueueChange and enters the bounded retry effect below.
    refresh().then((next) => {
      if (active && isOnline() && next.total > 0) void sendSaved();
    });

    return () => {
      active = false;
      off();
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [refresh, sendSaved]);

  useEffect(() => {
    if (!online || sending || queue.total === 0) return undefined;
    const timer = window.setTimeout(
      () => void sendSaved({ advanceBackoff: true }),
      retryDelayRef.current,
    );
    return () => window.clearTimeout(timer);
  }, [online, queue.total, sending, retryTick, sendSaved]);

  if (online && queue.total === 0 && !sending) return null;

  const retry = async () => {
    retryDelayRef.current = RETRY_INITIAL_MS;
    await sendSaved();
  };

  const savedSummary = [
    queue.records > 0
      ? `${queue.records} work ${queue.records === 1 ? "item" : "items"}`
      : null,
    queue.pings > 0
      ? `${queue.pings} location ${queue.pings === 1 ? "update" : "updates"}`
      : null,
  ].filter(Boolean).join(" and ");

  return (
    <div className={`dr-netbar ${online ? "" : "off"}`}>
      <div style={{ minWidth: 0 }}>
        <div className="dr-netbar-title">
          {online ? (sending ? "Sending saved updates…" : "Waiting to send") : "No signal"}
        </div>
        <div className="dr-netbar-sub">
          {queue.total > 0
            ? `${savedSummary} saved on this phone`
            : online
              ? "Everything is sent."
              : "Your work is saved here and sent when signal returns."}
        </div>
      </div>
      {online && queue.total > 0 && !sending && (
        <button type="button" className="dr-netbar-btn" onClick={retry}>
          Send now
        </button>
      )}
    </div>
  );
}
