import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getTripsPage, getTripSummary, groupStatusCounts } from "../../services/operations/tripService";

/**
 * The Trips list: which trips are showing, which page, and the counts above it.
 *
 * Filtering, searching and paging are done by the server. The page used to fetch
 * every trip (up to 1000) and filter in the browser, but the server returns at
 * most 100 per request, so past 100 trips the list, its totals and its export
 * were quietly incomplete.
 *
 * What this hook takes care of, so the page does not have to:
 *   • Changing any filter returns to page 1 (page 4 of the old result means
 *     nothing in the new one).
 *   • Typing in the search box waits for a pause before asking the server.
 *   • A request that is no longer wanted is cancelled, and a late answer to one
 *     can never overwrite the answer to the one that replaced it.
 *   • Landing on a page past the end (the last trips on it were closed or
 *     filtered away) steps back to the last real page, not an empty screen.
 */

export const PAGE_SIZE = 20;
const SEARCH_DELAY_MS = 300;

export const NO_FILTERS = Object.freeze({
  status: "all", priority: "all", barangay: "all", from: "", to: "", q: "",
});

const isAbort = (error) => error?.name === "AbortError";

function useDebounced(value, delay) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return settled;
}

export default function useTripList({ onError } = {}) {
  const [filters, setFilters] = useState(NO_FILTERS);
  const [page, setPage] = useState(1);
  const [state, setState] = useState({
    rows: [], pagination: { page: 1, limit: PAGE_SIZE, total: 0, totalPages: 0 },
  });
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState({ counts: {}, total: 0, barangays: [] });
  // Bumped to ask for a fresh copy of the current page and the counts.
  const [tick, setTick] = useState(0);

  const search = useDebounced(filters.q.trim(), SEARCH_DELAY_MS);
  const report = useRef(onError);
  report.current = onError;

  // What the server is asked for. Memoised on its parts so a re-render that
  // changes nothing does not look like a new query.
  const { status, priority, barangay, from, to } = filters;
  const query = useMemo(
    () => ({ status, priority, barangay, from, to, search, page, limit: PAGE_SIZE }),
    [status, priority, barangay, from, to, search, page]
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    getTripsPage({ ...query, signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        const { total, totalPages } = result.pagination;
        if (!result.rows.length && total > 0 && query.page > totalPages) {
          setPage(totalPages); // stepped past the end: go to the last real page
          return;
        }
        setState(result);
        setLoading(false);
      })
      .catch((error) => {
        if (isAbort(error) || controller.signal.aborted) return;
        setLoading(false);
        report.current?.(error);
      });
    return () => controller.abort();
  }, [query, tick]);

  useEffect(() => {
    const controller = new AbortController();
    getTripSummary({ signal: controller.signal })
      .then((s) => { if (!controller.signal.aborted) setSummary(s); })
      .catch(() => { /* the cards keep their last numbers; the list reports its own failure */ });
    return () => controller.abort();
  }, [tick]);

  const setFilter = useCallback((key, value) => {
    setFilters((f) => (f[key] === value ? f : { ...f, [key]: value }));
    setPage(1);
  }, []);

  const clearFilters = useCallback(() => {
    setFilters((f) => ({ ...NO_FILTERS, status: f.status, q: f.q }));
    setPage(1);
  }, []);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const stats = useMemo(() => groupStatusCounts(summary.counts, summary.total), [summary]);

  return {
    filters,
    setFilter,
    clearFilters,
    /** The filters that narrow by detail (not the status tabs or the search box). */
    detailFiltersActive: priority !== "all" || barangay !== "all" || Boolean(from) || Boolean(to),
    /** The same filters the list is using, for an export to match it exactly. */
    query,
    rows: state.rows,
    pagination: state.pagination,
    page,
    setPage,
    loading,
    stats,
    barangays: summary.barangays,
    reload,
  };
}
