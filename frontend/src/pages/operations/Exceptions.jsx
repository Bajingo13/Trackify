import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import AppShell from "../../components/layout/AppShell";
import {
  Search, Clock, CheckCircle2, ShieldAlert, Filter,
  ChevronDown, Eye, AlertCircle, X, ArrowUpCircle,
  CheckCircle, AlertOctagon, CircleDot, Plus, BellOff,
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import ExceptionBadge from "../../components/operations/ExceptionBadge";
import ExceptionStatusBadge from "../../components/operations/ExceptionStatusBadge";
import OpsStatCard from "../../components/operations/OpsStatCard";
import DriverReportPanel from "../../components/operations/DriverReportPanel";
import { useRealtime } from "../../services/realtime";
import TablePager from "../../components/shared/TablePager";
import { usePagination } from "../../hooks/usePagination";
import { useToast } from "../../components/shared/Toast";
import { SkeletonRows } from "../../motion/Skeleton";
import { Can } from "../../auth/permissions";
import {
  getExceptions,
  getExceptionStats,
  acknowledgeException,
  resolveException,
  createException,
  exceptionTypes,
  waitingFor,
} from "../../services/operations/exceptionService";
import { getAllTrips } from "../../services/operations/tripService";
import { Select } from "../../components/ui";
import "../../styles/operations.css";

/** "Aug 28, 6:45 AM" — the full timestamp stays available on hover. */
const fmtDetected = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

const SEVERITIES = [
  { value: "critical", label: "Critical" },
  { value: "warning", label: "Warning" },
  { value: "info", label: "Info" },
];

function RaiseExceptionForm({ onClose, onCreated }) {
  const { addToast } = useToast();
  const [trips, setTrips] = useState([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    exceptionType: "trip_delay", severity: "warning", tripTicketId: "", title: "", description: "",
  });

  useEffect(() => {
    getAllTrips({ limit: 200 }).then(setTrips).catch(() => setTrips([]));
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      const res = await createException({
        exceptionType: form.exceptionType,
        severity: form.severity,
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        tripTicketId: form.tripTicketId ? Number(form.tripTicketId) : undefined,
      });
      addToast(res?.message || "Exception raised.", "success");
      onCreated?.();
      onClose();
    } catch (err) {
      addToast(err.message || "Failed to raise exception.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ops-modal-overlay soft-modal-backdrop" onClick={onClose}>
      <div className="ops-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="ops-modal-header">
          <div>
            <h3 className="ops-modal-title">Raise Exception</h3>
            <span style={{ fontSize: 13, color: "var(--trackify-text-secondary)" }}>
              Log an operational issue for follow-up
            </span>
          </div>
          <button className="ops-btn ops-btn-ghost" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={submit}>
          <div className="ops-modal-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="ops-form-group">
                <label className="ops-form-label">Type *</label>
                <Select value={form.exceptionType} onChange={(v) => set("exceptionType")({ target: { value: v } })}
                  options={Object.entries(exceptionTypes).map(([k, v]) => ({ value: k, label: v }))} />
              </div>
              <div className="ops-form-group">
                <label className="ops-form-label">Severity *</label>
                <Select value={form.severity} onChange={(v) => set("severity")({ target: { value: v } })}
                  options={SEVERITIES} />
              </div>
            </div>
            <div className="ops-form-group">
              <label className="ops-form-label">Trip Ticket</label>
              <Select value={form.tripTicketId} onChange={(v) => set("tripTicketId")({ target: { value: v } })}
                placeholder="Not trip-specific"
                options={trips.map((t) => ({ value: t.id, label: `${t.ticketNo} — ${t.customer || `${t.origin} → ${t.destination}`}` }))} />
            </div>
            <div className="ops-form-group">
              <label className="ops-form-label">Title *</label>
              <input
                className="ops-form-input"
                value={form.title}
                onChange={set("title")}
                placeholder="e.g. Driver reported vehicle breakdown on NLEX"
                required
              />
            </div>
            <div className="ops-form-group">
              <label className="ops-form-label">Description</label>
              <textarea
                className="ops-form-input ops-form-textarea"
                value={form.description}
                onChange={set("description")}
                placeholder="What happened, where, and any immediate action taken..."
              />
            </div>
          </div>
          <div className="ops-modal-footer">
            <button type="button" className="ops-btn ops-btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="ops-btn ops-btn-primary" disabled={saving || !form.title.trim()}>
              {saving ? "Raising…" : "Raise Exception"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const STATUS_OPTIONS = ["all", "open", "acknowledged", "resolved"];
const SEVERITY_OPTIONS = ["all", "critical", "warning", "info"];

function ExceptionDetail({ exception, onClose, onAcknowledge, onResolve, onChanged, busy }) {
  const [resolutionNotes, setResolutionNotes] = useState("");

  useEffect(() => {
    setResolutionNotes(exception?.resolutionNotes || "");
  }, [exception]);

  if (!exception) return null;

  const isPause = exception.sourceKind === "pause";
  // settled in Fleet → Inspections (approve departure / mark reviewed), not here
  const isInspection = exception.sourceKind === "inspection";

  const timeline = [
    { icon: AlertCircle, color: "#EF4444", bg: "#FEF2F2", label: "Exception Detected", time: exception.detectedAt },
    ...(exception.acknowledgedAt
      ? [{ icon: CheckCircle, color: "#2455D6", bg: "#EEF4FF", label: "Acknowledged", time: exception.acknowledgedAt }]
      : []),
    ...(exception.resolvedAt
      ? [{ icon: CheckCircle2, color: "#22C55E", bg: "#DCFCE7", label: "Resolved", time: exception.resolvedAt }]
      : []),
  ];

  return (
    <div className="ops-modal-overlay soft-modal-backdrop" onClick={onClose}>
      <div
        className="ops-modal ops-exception-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="exception-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ops-modal-header">
          <div className="ops-exception-heading">
            <h3 className="ops-modal-title" id="exception-detail-title">Exception Details</h3>
            <div className="ops-exception-title">{exception.title || exceptionTypes[exception.type] || exception.type}</div>
            <div className="ops-exception-badges">
              <ExceptionBadge severity={exception.severity} />
              <ExceptionStatusBadge status={exception.status} />
            </div>
          </div>
          <button className="ops-btn ops-btn-ghost ops-modal-close" onClick={onClose} aria-label="Close exception details">
            <X size={18} />
          </button>
        </div>

        <div className="ops-modal-body">
          <section className="ops-exception-summary" aria-label="Exception summary">
            <dl className="ops-exception-facts">
              <div><dt>Trip</dt><dd className="ops-exception-ticket">{exception.tripTicket || "N/A"}</dd></div>
              <div><dt>Driver</dt><dd>{exception.driver || "N/A"}</dd></div>
              <div><dt>Vehicle</dt><dd>{exception.vehicle || "N/A"}</dd></div>
              <div><dt>Detected</dt><dd title={exception.detectedAt}>{fmtDetected(exception.detectedAt)}</dd></div>
              <div className="ops-exception-location"><dt>Location</dt><dd>{exception.location || "Not provided"}</dd></div>
            </dl>
          </section>

          {!isPause && exception.description && (
            <section className="ops-exception-description" aria-labelledby="exception-description-title">
              <h4 id="exception-description-title">Description</h4>
              <p>{exception.description}</p>
            </section>
          )}

          <DriverReportPanel exception={exception} onChanged={onChanged} />

          {exception.resolutionNotes && !isPause && (
            <section className="ops-exception-resolution" aria-labelledby="exception-resolution-title">
              <h4 id="exception-resolution-title">Resolution</h4>
              <p>{exception.resolutionNotes}</p>
            </section>
          )}

          {exception.status !== "resolved" && !isPause && !isInspection && (
            <div className="ops-form-group ops-exception-resolve">
              <label className="ops-form-label" htmlFor="resolution-notes">
                How was this resolved? <span aria-hidden="true">*</span>
              </label>
              <textarea
                id="resolution-notes"
                className="ops-form-input ops-form-textarea"
                placeholder="Add a short note for the operations record."
                value={resolutionNotes}
                onChange={(event) => setResolutionNotes(event.target.value)}
                disabled={busy}
              />
            </div>
          )}

          <details className="ops-exception-activity">
            <summary>Activity <span>{timeline.length}</span></summary>
            <div className="ops-exception-timeline">
              {timeline.map((event, i) => {
                const isLast = i === timeline.length - 1;
                return (
                  <div className="ops-exception-event" key={i}>
                    <div className="ops-exception-event-rail">
                      <div className="ops-exception-event-icon" style={{ background: event.bg }}>
                        <event.icon size={14} style={{ color: event.color }} aria-hidden="true" />
                      </div>
                      {!isLast && <div className="ops-exception-event-line" />}
                    </div>
                    <div className="ops-exception-event-copy">
                      <strong>{event.label}</strong>
                      <span>{fmtDetected(event.time)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </details>
        </div>

        <div className="ops-modal-footer">
          <button className="ops-btn ops-btn-secondary" onClick={onClose}>Close</button>
          {exception.status === "open" && exception.sourceKind !== "pause" && (
            <Can permission="exception.resolve">
              <button
                className="ops-btn ops-btn-secondary"
                onClick={() => onAcknowledge(exception)}
                disabled={busy}
              >
                <CheckCircle size={14} /> {busy ? "Saving..." : "Acknowledge"}
              </button>
            </Can>
          )}
          {exception.status !== "resolved" && !isPause && !isInspection && (
            <Can permission="exception.resolve">
              <button
                className="ops-btn ops-btn-primary"
                onClick={() => onResolve(exception, resolutionNotes)}
                disabled={busy || !resolutionNotes.trim()}
              >
                <CheckCircle2 size={14} /> {busy ? "Saving..." : "Resolve exception"}
              </button>
            </Can>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ExceptionsPage() {
  const { addToast } = useToast();
  const [allExceptions, setAllExceptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  /* Alert kinds this person muted on the Notifications screen. The server
   * leaves them out of the rows, so the board says so rather than looking
   * quietly empty. */
  const [mutedTypes, setMutedTypes] = useState([]);
  const [busyExceptionId, setBusyExceptionId] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  /* Which part of the board is on screen. Work still to do is shown by default and
   * finished exceptions have their own place, so the board is not buried in old ones. */
  const [view, setView] = useState("active");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [showFilters, setShowFilters] = useState(false);
  const [selectedException, setSelectedException] = useState(null);
  const [showRaise, setShowRaise] = useState(false);
  // ?exception=<id>: arrived from the notification bell — open that one.
  const [searchParams, setSearchParams] = useSearchParams();
  const wanted = Number(searchParams.get("exception")) || null;
  const filterRef = useRef(null);

  const loadExceptions = useCallback(async ({ quiet = false } = {}) => {
    // a refresh nobody asked for must not blank the board or throw away an open detail
    if (!quiet) {
      setLoading(true);
      setLoadError("");
    }
    try {
      const { items, muted } = await getExceptions();
      setAllExceptions(items);
      setMutedTypes(muted);
      setSelectedException((current) => (current ? items.find((item) => item.id === current.id) || current : current));
      return items;
    } catch (error) {
      if (!quiet) setLoadError(error.message || "Failed to load exceptions.");
      return null;
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadExceptions();
  }, [loadExceptions]);

  // What a driver reports, and what the office decides on it, reaches this board
  // as it happens; the timer is for a socket that is down.
  useRealtime((msg) => {
    if (msg.type === "trip:pause" || msg.type === "support:ticket" || msg.type === "support:message" || msg.type === "trip:status") {
      loadExceptions({ quiet: true });
    }
  }, undefined, () => loadExceptions({ quiet: true }));
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") loadExceptions({ quiet: true });
    }, 60000);
    return () => window.clearInterval(timer);
  }, [loadExceptions]);

  useEffect(() => {
    if (!wanted) return;
    const found = allExceptions.find((item) => item.id === wanted);
    if (!found) return;
    if (found.status === "resolved") setView("finished");
    setSelectedException(found);
    setSearchParams((params) => { params.delete("exception"); return params; }, { replace: true });
  }, [wanted, allExceptions, setSearchParams]);

  useEffect(() => {
    if (!showFilters) return;
    const handler = (e) => {
      if (filterRef.current && !filterRef.current.contains(e.target)) setShowFilters(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showFilters]);

  const stats = useMemo(() => getExceptionStats(allExceptions), [allExceptions]);

  async function runAction(exception, action) {
    setBusyExceptionId(exception.id);
    try {
      const response = await action();
      addToast(response.message || "Exception updated.", "success");
      const rows = await loadExceptions();
      if (rows) {
        setSelectedException(rows.find((item) => item.id === exception.id) || null);
      }
    } catch (error) {
      addToast(error.message || "Failed to update exception.", "error");
    } finally {
      setBusyExceptionId(null);
    }
  }

  function handleAcknowledge(exception) {
    return runAction(exception, () => acknowledgeException(exception.id));
  }

  function handleResolve(exception, notes) {
    return runAction(exception, () => resolveException(exception.id, notes));
  }

  /* Choosing a status also moves to the part of the board it lives in. */
  function chooseStatus(next) {
    setStatusFilter(next);
    if (next === "resolved") setView("finished");
    else if (next !== "all") setView("active");
  }

  const counts = useMemo(() => ({
    active: allExceptions.filter((e) => e.status !== "resolved").length,
    finished: allExceptions.filter((e) => e.status === "resolved").length,
  }), [allExceptions]);

  const filtered = useMemo(() => {
    let result = allExceptions;
    if (view === "active") result = result.filter((e) => e.status !== "resolved");
    else if (view === "finished") {
      result = result
        .filter((e) => e.status === "resolved")
        .sort((a, b) => new Date(b.resolvedAt || 0) - new Date(a.resolvedAt || 0));
    }
    if (statusFilter !== "all") result = result.filter((e) => e.status === statusFilter);
    if (severityFilter !== "all") result = result.filter((e) => e.severity === severityFilter);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (e) =>
          (e.tripTicket && e.tripTicket.toLowerCase().includes(q)) ||
          e.description.toLowerCase().includes(q) ||
          (e.driver && e.driver.toLowerCase().includes(q)) ||
          (e.vehicle && e.vehicle.toLowerCase().includes(q)) ||
          e.location.toLowerCase().includes(q)
      );
    }
    return result;
  }, [allExceptions, view, statusFilter, severityFilter, search]);

  /* The whole list stays together; the table shows a page of it. A new search or filter starts again at page 1. */
  const pager = usePagination(filtered, {
    initialSize: 10,
    resetKey: `${view}|${statusFilter}|${severityFilter}|${search}`,
    storeKey: "exceptions",
  });

  const hasActiveFilters = statusFilter !== "all" || severityFilter !== "all";

  return (
    <AppShell>
      <div className="ops-container">
        <div className="ops-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div className="ops-header-left">
            <h1 className="ops-title">Exceptions</h1>
            <p className="ops-subtitle">Manage exceptions for in-transit trips</p>
          </div>
          <Can permission="exception.create">
            <button className="ops-btn ops-btn-primary" onClick={() => setShowRaise(true)}>
              <Plus size={15} /> Raise Exception
            </button>
          </Can>
        </div>

        <div className="ops-stats-bar">
          <OpsStatCard
            icon={AlertCircle} label="Open" count={stats.open} hint="Requires attention"
            color="var(--danger)" bg="var(--danger-soft)"
            active={statusFilter === "open"}
            onClick={() => chooseStatus(statusFilter === "open" ? "all" : "open")}
          />
          <OpsStatCard
            icon={Clock} label="Acknowledged" count={stats.acknowledged} hint="Being handled"
            color="var(--warn)" bg="var(--warn-soft)"
            active={statusFilter === "acknowledged"}
            onClick={() => chooseStatus(statusFilter === "acknowledged" ? "all" : "acknowledged")}
          />
          <OpsStatCard
            icon={CheckCircle2} label="Resolved" count={stats.resolved} hint="Completed"
            color="var(--ok)" bg="var(--ok-soft)"
            active={statusFilter === "resolved"}
            onClick={() => chooseStatus(statusFilter === "resolved" ? "all" : "resolved")}
          />
          <OpsStatCard
            icon={ShieldAlert} label="Critical" count={stats.critical} hint="Immediate attention"
            color="var(--danger)" bg="var(--danger-soft)"
            active={severityFilter === "critical"}
            onClick={() => setSeverityFilter((v) => (v === "critical" ? "all" : "critical"))}
          />
        </div>

        <div className="ops-content-section">
          <div className="ops-content-header">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h3 className="ops-content-title">Exception Log</h3>
              <span style={{
                fontSize: 11, color: "var(--trackify-text-muted)", background: "#F1F5F9",
                padding: "2px 8px", borderRadius: 6, fontWeight: 600,
              }}>
                {filtered.length} of {allExceptions.length}
              </span>
              <div style={{ display: "flex", gap: 4 }} role="group" aria-label="Show exceptions">
                {[
                  { id: "active", label: "Active", n: counts.active },
                  { id: "finished", label: "Finished", n: counts.finished },
                  { id: "all", label: "All", n: allExceptions.length },
                ].map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    className={`ops-filter-chip ${view === v.id ? "active" : ""}`}
                    aria-pressed={view === v.id}
                    onClick={() => {
                      setView(v.id);
                      // a status picked earlier that this part cannot hold would only show an empty board
                      if (v.id === "active" && statusFilter === "resolved") setStatusFilter("all");
                      if (v.id === "finished" && (statusFilter === "open" || statusFilter === "acknowledged")) setStatusFilter("all");
                    }}
                  >
                    {v.label} ({v.n})
                  </button>
                ))}
              </div>
            </div>
            <div className="ops-filters-row">
              <div className="ops-search" style={{ maxWidth: 280 }}>
                <Search size={14} style={{ color: "var(--trackify-text-muted)", flexShrink: 0 }} />
                <input
                  type="text"
                  placeholder="Search exceptions..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="ops-dropdown" ref={filterRef}>
                <button
                  className={`ops-btn ops-btn-secondary ${hasActiveFilters ? "ops-btn-active" : ""}`}
                  onClick={() => setShowFilters(!showFilters)}
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", fontSize: 13 }}
                >
                  <Filter size={14} />
                  Filters
                  {hasActiveFilters && (
                    <span style={{
                      width: 18, height: 18, borderRadius: 5, background: "var(--trackify-blue)",
                      color: "#fff", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {(statusFilter !== "all" ? 1 : 0) + (severityFilter !== "all" ? 1 : 0)}
                    </span>
                  )}
                  <ChevronDown size={13} style={{ transform: showFilters ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
                </button>
                {showFilters && (
                  <div className="ops-dropdown-menu">
                    <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--trackify-border-soft)" }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--trackify-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Status</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {STATUS_OPTIONS.map((s) => (
                          <button key={s} className={`ops-filter-chip ${statusFilter === s ? "active" : ""}`} onClick={() => chooseStatus(s)}>
                            {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div style={{ padding: "10px 14px" }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--trackify-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Severity</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {SEVERITY_OPTIONS.map((s) => (
                          <button key={s} className={`ops-filter-chip ${severityFilter === s ? "active" : ""}`} onClick={() => setSeverityFilter(s)}>
                            {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
                          </button>
                        ))}
                      </div>
                    </div>
                    {hasActiveFilters && (
                      <div style={{ padding: "8px 14px", borderTop: "1px solid var(--trackify-border-soft)" }}>
                        <button
                          className="ops-btn ops-btn-ghost"
                          style={{ width: "100%", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}
                          onClick={() => { setStatusFilter("all"); setSeverityFilter("all"); }}
                        >
                          <X size={12} /> Clear Filters
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {!loading && !loadError && mutedTypes.length > 0 && (
            <div
              style={{
                display: "flex", alignItems: "center", gap: 8, padding: "8px 14px",
                borderTop: "1px solid var(--trackify-border-soft)",
                fontSize: 12, color: "var(--trackify-text-muted, #6B7280)",
              }}
            >
              <BellOff size={13} style={{ flexShrink: 0 }} />
              <span>
                {mutedTypes.length} alert {mutedTypes.length === 1 ? "type is" : "types are"} muted for you
                ({mutedTypes.map((t) => exceptionTypes[t] || t).join(", ")}) and left off this board.
              </span>
              <Link to="/admin/settings/notifications" style={{ color: "inherit", textDecoration: "underline" }}>
                Change
              </Link>
            </div>
          )}

          <div className="ops-table-wrapper">
            {loading ? (
              <SkeletonRows cols={8} rows={6} />
            ) : loadError ? (
              <div className="ops-empty">
                <AlertOctagon size={24} style={{ color: "#EF4444", marginBottom: 8 }} />
                <div className="ops-empty-title">Unable to load exceptions</div>
                <div className="ops-empty-desc">{loadError}</div>
                <button className="ops-btn ops-btn-secondary" onClick={loadExceptions} style={{ marginTop: 12 }}>
                  Try Again
                </button>
              </div>
            ) : filtered.length === 0 ? (
              <div className="ops-empty">
                <div style={{
                  width: 48, height: 48, borderRadius: 12, background: "#EEF4FF",
                  display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 8px",
                }}>
                  <AlertCircle size={22} style={{ color: "#2455D6", opacity: 0.5 }} />
                </div>
                <div className="ops-empty-title">
                  {view === "active" && !search && counts.finished > 0 ? "No active exceptions" : view === "finished" && !search ? "Nothing finished yet" : "No exceptions found"}
                </div>
                <div className="ops-empty-desc">
                  {search
                    ? "Try adjusting your search criteria"
                    : view === "active"
                      ? counts.finished > 0
                        ? "Everything has been handled. Finished exceptions are under Finished."
                        : "All trips are running smoothly"
                      : view === "finished"
                        ? "Exceptions move here once they are resolved."
                        : "All trips are running smoothly"}
                </div>
              </div>
            ) : (
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Trip Ticket</th>
                    <th>Severity</th>
                    <th>Status</th>
                    <th>Driver</th>
                    <th>Vehicle</th>
                    <th>{view === "finished" ? "Resolved" : "Detected"}</th>
                    <th style={{ textAlign: "right" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pager.pageItems.map((exception) => (
                    <tr
                      key={exception.id}
                      className={selectedException?.id === exception.id ? "ops-row-selected" : ""}
                      style={{ cursor: "pointer" }}
                      onClick={() => setSelectedException(exception)}
                    >
                      <td className="ops-sev-cell">
                        <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                          <span style={{ fontWeight: 600, color: "var(--text)" }}>
                            {exceptionTypes[exception.type] || exception.type}
                            {exception.sourceKind && (
                              <span className="ops-source-chip" title="Filed by the driver from the Driver app">
                                {exception.sourceKind === "pause" ? "Pause request" : exception.sourceKind === "inspection" ? "Inspection" : "From driver"}
                              </span>
                            )}
                          </span>
                          {exception.title && (
                            <span style={{ fontSize: "var(--fs-12)", color: "var(--text-3)", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }}>
                              {exception.title}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="ops-ticket-no">{exception.tripTicket || "N/A"}</td>
                      <td><ExceptionBadge severity={exception.severity} /></td>
                      <td>
                        <ExceptionStatusBadge status={exception.status} />
                        {(() => {
                          const wait = waitingFor(exception);
                          return wait ? (
                            <span className="ops-waiting" data-tone={wait.tone} title="The driver's last message has not been answered">
                              Waiting {wait.text}
                            </span>
                          ) : null;
                        })()}
                      </td>
                      <td>{exception.driver || "—"}</td>
                      <td>{exception.vehicle || "—"}</td>
                      {(() => {
                        const at = view === "finished" ? exception.resolvedAt : exception.detectedAt;
                        return <td title={at ? new Date(at).toLocaleString() : undefined}>{fmtDetected(at)}</td>;
                      })()}
                      <td style={{ textAlign: "right" }}>
                        <button
                          className="ops-btn ops-btn-secondary"
                          style={{ padding: "4px 10px", fontSize: 11 }}
                          onClick={(e) => { e.stopPropagation(); setSelectedException(exception); }}
                        >
                          <Eye size={12} /> View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {!loading && !loadError && <TablePager pager={pager} noun="exceptions" />}
        </div>
      </div>

      {selectedException && (
        <ExceptionDetail
          exception={selectedException}
          onClose={() => setSelectedException(null)}
          onAcknowledge={handleAcknowledge}
          onResolve={handleResolve}
          onChanged={() => loadExceptions({ quiet: true })}
          busy={busyExceptionId === selectedException.id}
        />
      )}

      {showRaise && (
        <RaiseExceptionForm
          onClose={() => setShowRaise(false)}
          onCreated={loadExceptions}
        />
      )}
    </AppShell>
  );
}
