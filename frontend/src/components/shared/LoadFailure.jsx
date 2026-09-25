import { AlertTriangle, RefreshCw, WifiOff } from "lucide-react";

/**
 * What a screen shows when the data did not arrive.
 *
 * Two different situations, deliberately told apart, because conflating them
 * is what made this necessary:
 *
 *   <LoadFailure>  nothing has ever loaded. The page must NOT fall back to its
 *                  empty state — on a report that means ₱0.00 totals which
 *                  read as a real answer.
 *
 *   <StaleData>    something is on screen but the latest refresh failed. The
 *                  figures stay, and the page says how old they are instead of
 *                  quietly presenting them as current.
 */

const offline = () => typeof navigator !== "undefined" && navigator.onLine === false;

/** Plain words for the cause, where the cause is knowable. */
function explain(error) {
  if (offline()) return "This device is offline.";
  // Set by fetchWithTimeout, so these do not depend on a browser's wording.
  if (error?.code === "TIMEOUT") return "The server took too long to answer.";
  if (error?.code === "NETWORK") return "The server could not be reached.";
  if (error?.status === 403) return "You do not have permission to see this.";
  if (error?.status === 404) return "That is no longer available.";
  if (error?.status >= 500) return "The server had a problem answering.";
  if (/fetch|network/i.test(error?.message || "")) return "The server could not be reached.";
  return error?.message || "The request did not complete.";
}

export default function LoadFailure({ error, onRetry, what = "this page", retrying = false }) {
  const Icon = offline() ? WifiOff : AlertTriangle;
  return (
    <div
      role="alert"
      style={{
        display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
        padding: "var(--s-7, 32px) var(--s-5, 20px)", textAlign: "center",
        border: "1px solid var(--line)", borderRadius: "var(--r-md, 12px)",
        background: "var(--surface)",
      }}
    >
      <Icon size={22} style={{ color: "var(--danger)" }} />
      <div style={{ fontSize: "var(--fs-14)", fontWeight: 700, color: "var(--text)" }}>
        Could not load {what}
      </div>
      <div style={{ fontSize: "var(--fs-12)", color: "var(--text-3)", maxWidth: 420, lineHeight: 1.5 }}>
        {explain(error)} Nothing here is out of date — it simply has not been loaded, so no
        figures are shown rather than showing zeros.
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          style={{
            marginTop: 4, display: "inline-flex", alignItems: "center", gap: 7,
            padding: "7px 14px", fontSize: "var(--fs-12)", fontWeight: 600,
            borderRadius: "var(--r-sm)", cursor: retrying ? "progress" : "pointer",
            background: "var(--surface)", color: "var(--text)",
            border: "1px solid var(--line-strong)",
          }}
        >
          <RefreshCw size={13} style={{ animation: retrying ? "spin 1s linear infinite" : "none" }} />
          {retrying ? "Trying…" : "Try again"}
        </button>
      )}
    </div>
  );
}

export function StaleData({ error, onRetry, lastUpdated, retrying = false }) {
  return (
    <div
      role="status"
      style={{
        display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
        padding: "9px 13px", marginBottom: "var(--s-4, 16px)",
        border: "1px solid var(--warn-line)", background: "var(--warn-soft)",
        borderRadius: "var(--r-sm)", fontSize: "var(--fs-12)", color: "var(--text-2)",
      }}
    >
      <AlertTriangle size={14} style={{ color: "var(--warn)", flexShrink: 0 }} />
      <span>
        These figures are from{" "}
        <strong>{lastUpdated ? lastUpdated.toLocaleTimeString() : "an earlier load"}</strong>.
        The latest refresh failed — {explain(error).toLowerCase()}
      </span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          style={{
            marginLeft: "auto", padding: "4px 10px", fontSize: "var(--fs-11)", fontWeight: 600,
            borderRadius: "var(--r-xs, 6px)", cursor: retrying ? "progress" : "pointer",
            background: "transparent", color: "var(--text)",
            border: "1px solid var(--line-strong)",
          }}
        >
          {retrying ? "Trying…" : "Retry"}
        </button>
      )}
    </div>
  );
}
