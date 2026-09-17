import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import AppShell from "../../components/layout/AppShell";
import {
  Search, Clock, CheckCircle2, ShieldAlert, Filter,
  ChevronDown, Eye, AlertCircle, X, ArrowUpCircle,
  CheckCircle, AlertOctagon, CircleDot, Plus,
} from "lucide-react";
import ExceptionBadge from "../../components/operations/ExceptionBadge";
import ExceptionStatusBadge from "../../components/operations/ExceptionStatusBadge";
import OpsStatCard from "../../components/operations/OpsStatCard";
import { useToast } from "../../components/shared/Toast";
import { SkeletonRows } from "../../motion/Skeleton";
import { Can } from "../../auth/permissions";
import {
  getAllExceptions,
  getExceptionStats,
  acknowledgeException,
  resolveException,
  createException,
  exceptionTypes,
} from "../../services/operations/exceptionService";
import { getAllTrips } from "../../services/operations/tripService";
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
    <div className="ops-modal-overlay" onClick={onClose}>
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
                <select className="ops-form-input" value={form.exceptionType} onChange={set("exceptionType")}>
                  {Object.entries(exceptionTypes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="ops-form-group">
                <label className="ops-form-label">Severity *</label>
                <select className="ops-form-input" value={form.severity} onChange={set("severity")}>
                  {SEVERITIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
            </div>
            <div className="ops-form-group">
              <label className="ops-form-label">Trip Ticket</label>
              <select className="ops-form-input" value={form.tripTicketId} onChange={set("tripTicketId")}>
                <option value="">Not trip-specific</option>
                {trips.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.ticketNo} — {t.customer || `${t.origin} → ${t.destination}`}
                  </option>
                ))}
              </select>
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

function ExceptionDetail({ exception, onClose, onAcknowledge, onResolve, busy }) {
  const [resolutionNotes, setResolutionNotes] = useState("");

  useEffect(() => {
    setResolutionNotes(exception?.resolutionNotes || "");
  }, [exception]);

  if (!exception) return null;

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
    <div className="ops-modal-overlay" onClick={onClose}>
      <div className="ops-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
        <div className="ops-modal-header">
          <div>
            <h3 className="ops-modal-title">Exception Details</h3>
            <span style={{ fontSize: 13, color: "var(--trackify-text-secondary)" }}>
              {exceptionTypes[exception.type] || exception.type}
            </span>
          </div>
          <button className="ops-btn ops-btn-ghost" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="ops-modal-body">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
            <div style={{ padding: "12px 14px", background: "#F8FAFC", borderRadius: 10 }}>
              <div className="ops-dispatch-card-detail">Trip Ticket</div>
              <div style={{ fontWeight: 600, fontSize: 14, color: "var(--trackify-blue)" }}>{exception.tripTicket || "N/A"}</div>
            </div>
            <div style={{ padding: "12px 14px", background: "#F8FAFC", borderRadius: 10 }}>
              <div className="ops-dispatch-card-detail">Location</div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{exception.location}</div>
            </div>
            <div style={{ padding: "12px 14px", background: "#F8FAFC", borderRadius: 10 }}>
              <div className="ops-dispatch-card-detail">Driver</div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{exception.driver || "N/A"}</div>
            </div>
            <div style={{ padding: "12px 14px", background: "#F8FAFC", borderRadius: 10 }}>
              <div className="ops-dispatch-card-detail">Vehicle</div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{exception.vehicle || "N/A"}</div>
            </div>
            <div style={{ padding: "12px 14px", background: "#F8FAFC", borderRadius: 10 }}>
              <div className="ops-dispatch-card-detail">Detected At</div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{new Date(exception.detectedAt).toLocaleString()}</div>
            </div>
            <div style={{ padding: "12px 14px", background: "#F8FAFC", borderRadius: 10, display: "flex", flexDirection: "column", gap: 4 }}>
              <div className="ops-dispatch-card-detail">Status</div>
              <ExceptionStatusBadge status={exception.status} />
            </div>
          </div>

          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--trackify-text-secondary)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Severity
            </div>
            <ExceptionBadge severity={exception.severity} />
          </div>

          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--trackify-text-secondary)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Description
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.6, color: "var(--trackify-text)", background: "#F8FAFC", padding: "12px 14px", borderRadius: 10 }}>
              {exception.description}
            </div>
          </div>

          {exception.resolutionNotes && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--trackify-text-secondary)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Resolution Notes
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.6, color: "var(--trackify-text)", background: "#DCFCE7", padding: "12px 14px", borderRadius: 10, border: "1px solid #BBF7D0" }}>
                {exception.resolutionNotes}
              </div>
            </div>
          )}

          {exception.status !== "resolved" && (
            <div className="ops-form-group" style={{ marginBottom: 20 }}>
              <label className="ops-form-label" htmlFor="resolution-notes">
                Resolution Notes
              </label>
              <textarea
                id="resolution-notes"
                className="ops-form-input ops-form-textarea"
                placeholder="Describe how the exception was resolved..."
                value={resolutionNotes}
                onChange={(event) => setResolutionNotes(event.target.value)}
                disabled={busy}
              />
            </div>
          )}

          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--trackify-text-secondary)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Timeline
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {timeline.map((event, i) => {
                const isLast = i === timeline.length - 1;
                return (
                  <div key={i} style={{ display: "flex", gap: 12 }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                      <div style={{
                        width: 28, height: 28, borderRadius: 8, background: event.bg,
                        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                      }}>
                        <event.icon size={14} style={{ color: event.color }} />
                      </div>
                      {!isLast && <div style={{ width: 1.5, height: 24, background: "#E2E8F0" }} />}
                    </div>
                    <div style={{ paddingBottom: isLast ? 0 : 12 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--trackify-text)" }}>{event.label}</div>
                      <div style={{ fontSize: 12, color: "var(--trackify-text-muted)" }}>{new Date(event.time).toLocaleString()}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="ops-modal-footer">
          <button className="ops-btn ops-btn-secondary" onClick={onClose}>Close</button>
          {exception.status === "open" && (
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
          {exception.status !== "resolved" && (
            <Can permission="exception.resolve">
              <button
                className="ops-btn ops-btn-primary"
                onClick={() => onResolve(exception, resolutionNotes)}
                disabled={busy || !resolutionNotes.trim()}
              >
                <CheckCircle2 size={14} /> {busy ? "Saving..." : "Resolve"}
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
  const [busyExceptionId, setBusyExceptionId] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [showFilters, setShowFilters] = useState(false);
  const [selectedException, setSelectedException] = useState(null);
  const [showRaise, setShowRaise] = useState(false);
  const filterRef = useRef(null);

  const loadExceptions = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const rows = await getAllExceptions();
      setAllExceptions(rows);
      return rows;
    } catch (error) {
      setLoadError(error.message || "Failed to load exceptions.");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadExceptions();
  }, [loadExceptions]);

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

  const filtered = useMemo(() => {
    let result = allExceptions;
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
  }, [allExceptions, statusFilter, severityFilter, search]);

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
            onClick={() => setStatusFilter((v) => (v === "open" ? "all" : "open"))}
          />
          <OpsStatCard
            icon={Clock} label="Acknowledged" count={stats.acknowledged} hint="Being handled"
            color="var(--warn)" bg="var(--warn-soft)"
            active={statusFilter === "acknowledged"}
            onClick={() => setStatusFilter((v) => (v === "acknowledged" ? "all" : "acknowledged"))}
          />
          <OpsStatCard
            icon={CheckCircle2} label="Resolved" count={stats.resolved} hint="Completed"
            color="var(--ok)" bg="var(--ok-soft)"
            active={statusFilter === "resolved"}
            onClick={() => setStatusFilter((v) => (v === "resolved" ? "all" : "resolved"))}
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
                          <button key={s} className={`ops-filter-chip ${statusFilter === s ? "active" : ""}`} onClick={() => setStatusFilter(s)}>
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
                <div className="ops-empty-title">No exceptions found</div>
                <div className="ops-empty-desc">
                  {search ? "Try adjusting your search criteria" : "All trips are running smoothly"}
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
                    <th>Detected</th>
                    <th style={{ textAlign: "right" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((exception) => (
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
                      <td><ExceptionStatusBadge status={exception.status} /></td>
                      <td>{exception.driver || "—"}</td>
                      <td>{exception.vehicle || "—"}</td>
                      <td title={exception.detectedAt ? new Date(exception.detectedAt).toLocaleString() : undefined}>
                        {fmtDetected(exception.detectedAt)}
                      </td>
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
        </div>
      </div>

      {selectedException && (
        <ExceptionDetail
          exception={selectedException}
          onClose={() => setSelectedException(null)}
          onAcknowledge={handleAcknowledge}
          onResolve={handleResolve}
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
