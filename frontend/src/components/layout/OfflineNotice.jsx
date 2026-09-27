import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

/**
 * Says so when this computer loses its connection.
 *
 * Every request already explains its own failure (see fetchWithTimeout and
 * LoadFailure). What was missing is the warning before that: somebody filling
 * in a long trip ticket on a dropped office connection found out only when
 * they pressed Save. The staff console keeps nothing offline — unlike the
 * Driver App — so the honest thing is to say so while there is time to wait.
 *
 * navigator.onLine only knows about this machine's network, not whether the
 * server is reachable; that second case is still reported by the request
 * that fails.
 */
export default function OfflineNotice() {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  if (online) return null;
  return (
    <div
      role="status"
      style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "10px var(--s-5)",
        background: "var(--warn-soft)",
        borderBottom: "1px solid var(--warn-line)",
        color: "var(--text)",
        fontSize: "var(--fs-13)",
      }}
    >
      <WifiOff size={16} style={{ color: "var(--warn)", flexShrink: 0 }} aria-hidden="true" />
      <span>
        <strong>You're offline.</strong> Nothing you save will reach Trackify until the connection is back —
        keep this page open and try again then.
      </span>
    </div>
  );
}
