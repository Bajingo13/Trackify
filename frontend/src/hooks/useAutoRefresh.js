import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Runs `fn` on mount and every `intervalMs`, pausing while the browser tab is
 * hidden and re-running as soon as it becomes visible again.
 * Returns { refreshing, lastUpdated, refresh } — `refresh` is a manual trigger.
 */
export function useAutoRefresh(fn, intervalMs = 30000) {
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fnRef.current();
      setLastUpdated(new Date());
    } catch {
      /* keep the previous data on a transient failure */
    } finally {
      setRefreshing(false);
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

  return { refreshing, lastUpdated, refresh };
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
