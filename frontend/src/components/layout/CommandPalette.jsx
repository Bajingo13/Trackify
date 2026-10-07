import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, FileText, CornerDownLeft } from "lucide-react";
import { usePermissions } from "../../auth/permissions";
import { getAllTrips } from "../../services/operations/tripService";
import { searchPages, tripResult } from "./searchResults";

/**
 * Global search — Ctrl/⌘+K from anywhere in the console.
 *
 * Pages come from the same navigation tree the menus use, already filtered to
 * what this user may open. Trips are looked up on the server as the person
 * types (debounced), and only for users who can read trips, so the palette
 * never asks for something a role cannot see.
 */
export default function CommandPalette({ open, onClose }) {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const [query, setQuery] = useState("");
  const [trips, setTrips] = useState([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const canTrips = can("trip.read");

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setTrips([]);
    setActive(0);
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const q = query.trim();
    if (!open || !canTrips || q.length < 2) { setTrips([]); return undefined; }
    let live = true;
    const id = setTimeout(() => {
      getAllTrips({ search: q, limit: 5 })
        .then((rows) => { if (live) setTrips(rows.map(tripResult)); })
        .catch(() => { if (live) setTrips([]); });
    }, 250);
    return () => { live = false; clearTimeout(id); };
  }, [query, open, canTrips]);

  const results = useMemo(() => [...trips, ...searchPages(query, can).slice(0, 8)], [trips, query, can]);
  useEffect(() => { setActive(0); }, [query, trips.length]);

  if (!open) return null;

  const go = (r) => { onClose(); navigate(r.path); };
  const onKeyDown = (e) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && results[active]) { e.preventDefault(); go(results[active]); }
  };

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: "12vh", background: "rgba(7,26,74,0.28)" }}
    >
      <div
        role="dialog" aria-modal="true" aria-label="Search"
        onKeyDown={onKeyDown}
        style={{ width: "min(560px, calc(100vw - 32px))", background: "var(--surface)", border: "1px solid var(--line-strong)", borderRadius: "var(--r-md)", boxShadow: "var(--shadow-3, 0 24px 60px rgba(7,26,74,0.28))", overflow: "hidden" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: "1px solid var(--line)" }}>
          <Search size={16} style={{ color: "var(--text-3)" }} aria-hidden="true" />
          <input
            ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder={canTrips ? "Search pages or a trip number…" : "Search pages…"}
            aria-label="Search" role="combobox" aria-expanded="true" aria-controls="tk-search-list"
            aria-activedescendant={results[active] ? `tk-search-${active}` : undefined}
            style={{ flex: 1, border: "none", outline: "none", background: "transparent", color: "var(--text)", fontSize: "var(--fs-14, 14px)" }}
          />
          <kbd style={{ fontSize: 11, color: "var(--text-3)", border: "1px solid var(--line)", borderRadius: 4, padding: "1px 5px" }}>Esc</kbd>
        </div>
        <ul id="tk-search-list" role="listbox" style={{ listStyle: "none", margin: 0, padding: 6, maxHeight: 340, overflowY: "auto" }}>
          {results.length === 0 && (
            <li style={{ padding: "18px 12px", color: "var(--text-3)", fontSize: "var(--fs-13)" }}>No matches</li>
          )}
          {results.map((r, i) => (
            <li
              key={r.id} id={`tk-search-${i}`} role="option" aria-selected={i === active}
              onMouseEnter={() => setActive(i)} onClick={() => go(r)}
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
      </div>
    </div>
  );
}
