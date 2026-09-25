import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Runs `fn` on mount and every `intervalMs`, pausing while the browser tab is
 * hidden and re-running as soon as it becomes visible again.
 *
 * Returns { refreshing, lastUpdated, refresh, error, loaded }.
 *
 * On failure this used to swallow the error entirely, on the reasoning that a
 * transient blip should not throw away data already on screen. That is right
 * for a refresh and wrong for the first load, where there is no previous data
 * to keep: the page rendered its empty defaults instead, so a failed request
 * on a financial report showed ₱0.00 totals with no error and no way to retry.
 * Zero is an answer. Presenting it when the question was never answered is
 * worse than an error, because the reader has no reason to doubt it.
 *
 * So the two cases are now told apart:
 *
 *   • `loaded` is false until something has actually arrived. A caller that
 *     has never loaded should show the failure instead of its empty state.
 *   • `error` holds the last failure and is cleared by the next success, so a
 *     caller with data already on screen can keep showing it and say plainly
 *     that it is not current.
 */
export function useAutoRefresh(fn, intervalMs = 30000) {
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  /* The effect below re-runs when `intervalMs` changes, and a component that
   * unmounts mid-request must not set state afterwards. */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fnRef.current();
      if (!alive.current) return;
      setLastUpdated(new Date());
      setLoaded(true);
      setError(null);
    } catch (caught) {
      // Kept, not swallowed. What the caller does with it depends on whether
      // anything was ever loaded — see the note above.
      if (alive.current) setError(caught instanceof Error ? caught : new Error(String(caught)));
    } finally {
      if (alive.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(() => {
      if (!document.hidden) refresh();
    }, intervalMs);
    const onVis = () => { if (!document.hidden) refresh(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [intervalMs, refresh]);

  return { refreshing, lastUpdated, refresh, error, loaded };
}

export function relativeTime(date) {
  if (!date) return "";
  const s = Math.round((Date.now() - date.getTime()) / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}
