import { useEffect, useState } from "react";
import { isOnline, onQueueChange, pendingCount } from "./offlineQueue";
import { flushOutbox } from "./driverApi";

/**
 * Tells the driver the truth about their connection.
 *
 * Without this the app looks identical online and off, and a driver who taps
 * "confirm delivery" in a dead zone has no idea whether it landed. The bar
 * only appears when there is something to say.
 */
export default function OfflineBar() {
  const [online, setOnline] = useState(isOnline());
  const [queue, setQueue] = useState({ total: 0, pings: 0, records: 0 });
  const [sending, setSending] = useState(false);

  const refresh = () => pendingCount().then(setQueue).catch(() => {});

  useEffect(() => {
    refresh();
    const off = onQueueChange(refresh);

    const goOnline = async () => {
      setOnline(true);
      setSending(true);
      try { await flushOutbox(); } finally { setSending(false); refresh(); }
    };
    const goOffline = () => setOnline(false);

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);

    // catch anything left from a previous session
    if (isOnline()) goOnline();

    return () => {
      off();
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  if (online && queue.records === 0 && !sending) return null;

  const retry = async () => {
    setSending(true);
    try { await flushOutbox(); } finally { setSending(false); refresh(); }
  };

  return (
    <div className={`dr-netbar ${online ? "" : "off"}`}>
      <div style={{ minWidth: 0 }}>
        <div className="dr-netbar-title">
          {online ? (sending ? "Sending saved work…" : "Back online") : "No signal"}
        </div>
        <div className="dr-netbar-sub">
          {queue.records > 0
            ? `${queue.records} ${queue.records === 1 ? "item" : "items"} saved on this phone`
            : online
              ? "Everything is sent."
              : "Your work is saved here and sent when signal returns."}
        </div>
      </div>
      {online && queue.records > 0 && !sending && (
        <button type="button" className="dr-netbar-btn" onClick={retry}>
          Send now
        </button>
      )}
    </div>
  );
}
