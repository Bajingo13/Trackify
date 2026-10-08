import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, FileText, CornerDownLeft, Loader2, WifiOff, AlertCircle } from "lucide-react";
import { usePermissions } from "../../auth/permissions";
import { searchTrips } from "../../services/operations/tripService";
import { searchPages, tripResult } from "./searchResults";

const MIN_TRIP_QUERY = 2;
const DEBOUNCE_MS = 250;

/**
 * Global search — Ctrl/⌘+K from anywhere in the console.
 *
 * Pages come from the same navigation tree the menus use, already filtered to
 * what this user may open. Trips are looked up on the server as the person
 * types (debounced), and only for users who can read trips, so the palette
 * never asks for something a role cannot see.
 *
 * The trip lookup has four honest states — waiting, searching, failed, done —
 * because "No matches" is only true for the last. A search that failed (offline,
 * timed out, signed out) used to look identical to a ticket that does not exist.
 */
export default function CommandPalette({ open, onClose }) {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const [query, setQuery] = useState("");
  const [trips, setTrips] = useState([]);
  // "idle" | "waiting" (debouncing) | "loading" | "error" | "done"
  const [status, setStatus] = useState("idle");
  const [problem, setProblem] = useState(null);
  const [retry, setRetry] = useState(0);
  // The highlighted row is remembered by id, not position, so trips arriving
  // above the pages do not slide a different row under the person's choice.
  const [activeId, setActiveId] = useState(null);
  const inputRef = useRef(null);
  const enterQueued = useRef(false);
  const canTrips = can("trip.read");
  const q = query.trim();
  const wantsTrips = canTrips && q.length >= MIN_TRIP_QUERY;

  useEffect(() => {
    if (!open) return undefined;
    const before = document.activeElement;
    setQuery("");
    setTrips([]);
    setStatus("idle");
    setActiveId(null);
    inputRef.current?.focus();
    // Give focus back to whatever had it, so keyboard users are not dropped at
    // the top of the page after closing.
    return () => { try { before?.focus?.(); } catch { /* element gone */ } };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    if (!wantsTrips) { setTrips([]); setStatus("idle"); setProblem(null); return undefined; }

    // A new keystroke abandons the previous request outright rather than just
    // ignoring its answer, so a fast typist does not leave a queue on the server.
    const controller = new AbortController();
    setStatus("waiting");
    setProblem(null);
    const id = setTimeout(() => {
      setStatus("loading");
      searchTrips(q, { limit: 5, signal: controller.signal })
        .then((rows) => {
          if (controller.signal.aborted) return;
          setTrips(rows.map(tripResult));
          setStatus("done");
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          setTrips([]);
          setProblem(err);
          setStatus("error");
        });
    }, DEBOUNCE_MS);
    return () => { controller.abort(); clearTimeout(id); };
  }, [q, wantsTrips, open, retry]);

  const results = useMemo(() => [...trips, ...searchPages(query, can).slice(0, 8)], [trips, query, can]);
  useEffect(() => { setActiveId(null); }, [q]);
  const found = results.findIndex((r) => r.id === activeId);
  const active = found >= 0 ? found : 0;

  const pending = status === "waiting" || status === "loading";
  const go = useCallback((r) => { onClose(); navigate(r.path); }, [onClose, navigate]);

  // Enter pressed while trips were still on their way: do it once they land, so
  // "TT-0042⏎" opens the trip and not whichever page happened to match first.
  useEffect(() => {
    if (!enterQueued.current || pending) return;
    enterQueued.current = false;
    if (results[active]) go(results[active]);
  }, [pending, results, active, go]);

  if (!open) return null;

  const onKeyDown = (e) => {
    // Enter that confirms an IME candidate is not a command.
    if (e.nativeEvent?.isComposing || e.keyCode === 229) return;
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "Tab") { e.preventDefault(); inputRef.current?.focus(); } // focus stays in the dialog
    else if (e.key === "ArrowDown") { e.preventDefault(); setActiveId(results[Math.min(active + 1, results.length - 1)]?.id ?? null); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveId(results[Math.max(active - 1, 0)]?.id ?? null); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (pending && activeId === null) enterQueued.current = true;
      else if (results[active]) go(results[active]);
    }
  };

  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  let note = null;
  if (canTrips && q.length === 1) note = { text: "Type at least 2 characters to search trips." };
  else if (pending) note = { text: "Searching trips…", busy: true };
  else if (status === "error") {
    note = {
      error: true,
      text: offline || problem?.code === "NETWORK"
        ? "You're offline, so trips can't be searched. Pages still work."
        : problem?.status === 403
          ? "You don't have permission to search trips."
          : "Couldn't search trips. Check your connection and try again.",
      retry: problem?.status !== 403,
    };
  }

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={onKeyDown}
      style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: "12vh", background: "rgba(7,26,74,0.28)" }}
    >
      <div
        role="dialog" aria-modal="true" aria-label="Search"
        // Clicking the dialog's own padding must not pull focus off the input.
        onMouseDown={(e) => { if (e.target !== inputRef.current) e.preventDefault(); }}
        style={{ width: "min(560px, calc(100vw - 32px))", background: "var(--surface)", border: "1px solid var(--line-strong)", borderRadius: "var(--r-md)", boxShadow: "var(--shadow-3, 0 24px 60px rgba(7,26,74,0.28))", overflow: "hidden" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: "1px solid var(--line)" }}>
          <Search size={16} style={{ color: "var(--text-3)" }} aria-hidden="true" />
          <input
            ref={inputRef} value={query} onChange={(e) => { enterQueued.current = false; setQuery(e.target.value); }}
            placeholder={canTrips ? "Search pages or a trip number…" : "Search pages…"}
            aria-label="Search" role="combobox" aria-expanded={results.length > 0} aria-controls="tk-search-list"
            aria-activedescendant={results[active] ? `tk-search-${active}` : undefined}
            aria-busy={pending}
            autoComplete="off" spellCheck={false}
            style={{ flex: 1, border: "none", outline: "none", background: "transparent", color: "var(--text)", fontSize: "var(--fs-14, 14px)" }}
          />
          <kbd style={{ fontSize: 11, color: "var(--text-3)", border: "1px solid var(--line)", borderRadius: 4, padding: "1px 5px" }}>Esc</kbd>
        </div>
        <ul id="tk-search-list" role="listbox" aria-label="Results" style={{ listStyle: "none", margin: 0, padding: 6, maxHeight: 340, overflowY: "auto" }}>
          {results.length === 0 && !pending && status !== "error" && (
            <li role="presentation" style={{ padding: "18px 12px", color: "var(--text-3)", fontSize: "var(--fs-13)" }}>No matches</li>
          )}
          {results.map((r, i) => (
            <li
              key={r.id} id={`tk-search-${i}`} role="option" aria-selected={i === active}
              // mousemove, not mouseenter: a list that scrolls under a resting
              // pointer fires enter on whatever slides beneath it.
              onMouseMove={() => { if (r.id !== activeId) setActiveId(r.id); }}
              onClick={() => go(r)}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: "var(--r-sm)", cursor: "pointer", background: i === active ? "var(--surface-sunk)" : "transparent", color: "var(--text)" }}
            >
              <FileText size={14} style={{ color: r.kind === "trip" ? "var(--accent)" : "var(--text-3)", flexShrink: 0 }} aria-hidden="true" />
              <span style={{ fontWeight: 600, fontSize: "var(--fs-13)" }}>{r.label}</span>
              <span style={{ color: "var(--text-3)", fontSize: "var(--fs-12)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.kind === "trip" ? `Trip${r.hint ? ` · ${r.hint}` : ""}` : r.hint}
              </span>
              {i === active && <CornerDownLeft size={13} style={{ marginLeft: "auto", color: "var(--text-3)" }} aria-hidden="true" />}
            </li>
          ))}
        </ul>
        {/* Always mounted so assistive technology announces changes to it. */}
        <div
          role="status" aria-live="polite"
          style={note ? { display: "flex", alignItems: "center", gap: 8, padding: "9px 14px", borderTop: "1px solid var(--line)", fontSize: "var(--fs-12)", color: note.error ? "var(--warn, var(--text))" : "var(--text-3)" } : { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}
        >
          {note?.busy && <Loader2 size={13} aria-hidden="true" />}
          {note?.error && (offline || problem?.code === "NETWORK"
            ? <WifiOff size={13} aria-hidden="true" />
            : <AlertCircle size={13} aria-hidden="true" />)}
          <span>{note ? note.text : status === "done" ? `${results.length} result${results.length === 1 ? "" : "s"}` : ""}</span>
          {note?.retry && (
            <button type="button" onClick={() => setRetry((n) => n + 1)} style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: "inherit", textDecoration: "underline" }}>
              Try again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
