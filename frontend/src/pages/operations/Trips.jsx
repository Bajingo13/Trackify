import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import {
  Search, Plus, Filter, ChevronDown, Eye, Edit3, Send, UserPlus,
  MapPin, ClipboardCheck, X, ArrowLeft, Calendar, Package, Truck,
  FileText, Clock, CheckCircle2, Activity, Layers, CircleDot, CheckCircle,
} from "lucide-react";
import TopNav from "../../components/dashboard/TopNav";
import TripStatusBadge from "../../components/operations/TripStatusBadge";
import OpsStatCard from "../../components/operations/OpsStatCard";
import {
  getAllTrips, getTripById, getTripActivities, getTripStats, createTrip,
  submitTrip, validateTrip, approveTrip, rejectTrip, releaseTrip, startTrip,
  deliverTrip, closeTrip, cancelTrip, assignTrip, getAssignableResources,
} from "../../services/operations/tripService";
import { searchCustomers } from "../../services/operations/customerService";
import { useToast } from "../../components/shared/Toast";
import { Can, usePermissions } from "../../auth/permissions";
import "../../styles/operations.css";

/**
 * Which actions a trip offers in each status. Each is also permission-gated —
 * the button only shows if the user holds `perm`, and the API re-checks.
 */
const WORKFLOW = {
  draft:          [{ k: "submit",   label: "Submit for validation", perm: "trip.submit",  kind: "primary" }],
  for_validation: [{ k: "validate", label: "Validate",              perm: "trip.validate",kind: "primary" },
                   { k: "reject",   label: "Reject",                perm: "trip.reject",  kind: "danger", reason: "Why is this trip being rejected?" }],
  for_approval:   [{ k: "approve",  label: "Approve",               perm: "trip.approve", kind: "primary" },
                   { k: "reject",   label: "Reject",                perm: "trip.reject",  kind: "danger", reason: "Why is this trip being rejected?" }],
  approved:       [{ k: "assign",   label: "Assign driver & vehicle", perm: "trip.assign", kind: "primary" }],
  assigned:       [{ k: "release",  label: "Release for departure", perm: "trip.release", kind: "primary" },
                   { k: "assign",   label: "Reassign",              perm: "trip.assign",  kind: "default" }],
  released:       [{ k: "start",    label: "Start transit",         perm: "trip.release", kind: "primary" }],
  in_transit:     [{ k: "deliver",  label: "Confirm delivery",      perm: "trip.close",   kind: "primary", pod: true }],
  delivered:      [{ k: "close",    label: "Close trip",            perm: "trip.close",   kind: "primary" }],
};
const CANCELLABLE = ["draft", "for_validation", "for_approval", "approved", "assigned"];

const ACTION_FN = {
  submit: (id) => submitTrip(id),
  validate: (id) => validateTrip(id),
  approve: (id) => approveTrip(id),
  reject: (id, body) => rejectTrip(id, body),
  release: (id) => releaseTrip(id),
  start: (id) => startTrip(id),
  deliver: (id, body) => deliverTrip(id, body),
  close: (id) => closeTrip(id),
  cancel: (id, body) => cancelTrip(id, body),
};

/** datetime-local value ("2026-09-01T08:00") -> MySQL DATETIME ("2026-09-01 08:00:00") */
function toSqlDateTime(v) {
  if (!v) return null;
  return v.length === 16 ? `${v.replace("T", " ")}:00` : v.replace("T", " ");
}

const statusFilters = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "validated", label: "Validated" },
  { key: "for_approval", label: "For Approval" },
  { key: "approved", label: "Approved" },
  { key: "assigned", label: "Assigned" },
  { key: "in_transit", label: "In Transit" },
  { key: "delivered", label: "Delivered" },
  { key: "operationally_closed", label: "Closed" },
  { key: "rejected", label: "Rejected" },
  { key: "cancelled", label: "Cancelled" },
];

function getActions(status) {
  switch (status) {
    case "draft":
      return [
        { key: "view", label: "View", icon: Eye },
        { key: "edit", label: "Edit", icon: Edit3 },
        { key: "submit", label: "Submit", icon: Send },
      ];
    case "validated":
      return [
        { key: "view", label: "View", icon: Eye },
        { key: "submit", label: "Submit", icon: Send },
      ];
    case "for_approval":
      return [
        { key: "view", label: "View", icon: Eye },
      ];
    case "approved":
      return [
        { key: "view", label: "View", icon: Eye },
        { key: "assign", label: "Assign", icon: UserPlus },
      ];
    case "assigned":
    case "accepted":
    case "released":
      return [
        { key: "view", label: "View", icon: Eye },
        { key: "reassign", label: "Reassign", icon: UserPlus },
      ];
    case "in_transit":
      return [
        { key: "view", label: "View", icon: Eye },
        { key: "track", label: "Track", icon: MapPin },
      ];
    case "delivered":
      return [
        { key: "view", label: "View", icon: Eye },
        { key: "pod", label: "Review POD", icon: ClipboardCheck },
      ];
    default:
      return [
        { key: "view", label: "View", icon: Eye },
      ];
  }
}

function TripList({ trips, onViewTrip }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersRef = useRef(null);
  const perPage = 10;

  useEffect(() => {
    function handleClickOutside(e) {
      if (filtersRef.current && !filtersRef.current.contains(e.target)) {
        setFiltersOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filtered = useMemo(() => {
    let result = trips;
    if (statusFilter !== "all") {
      result = result.filter((t) => t.status === statusFilter);
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (t) =>
          t.ticketNo.toLowerCase().includes(q) ||
          t.customer.toLowerCase().includes(q) ||
          t.origin.toLowerCase().includes(q) ||
          t.destination.toLowerCase().includes(q) ||
          (t.driver && t.driver.toLowerCase().includes(q)) ||
          (t.vehicle && t.vehicle.toLowerCase().includes(q))
      );
    }
    return result;
  }, [trips, statusFilter, search]);

  const totalPages = Math.ceil(filtered.length / perPage);
  const paginated = filtered.slice((currentPage - 1) * perPage, currentPage * perPage);

  return (
    <div className="ops-card">
      <div className="ops-filters" style={{ justifyContent: "space-between" }}>
        <div className="ops-search">
          <Search size={14} style={{ color: "var(--trackify-text-muted)", flexShrink: 0 }} />
          <input
            type="text"
            placeholder="Search trips..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }}
          />
        </div>
        <div style={{ position: "relative" }} ref={filtersRef}>
          <button
            className="ops-btn ops-btn-secondary"
            onClick={() => setFiltersOpen(!filtersOpen)}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <Filter size={14} />
            Filters
            <ChevronDown
              size={13}
              style={{
                transform: filtersOpen ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 0.15s ease",
              }}
            />
            {statusFilter !== "all" && (
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#2455D6",
                  flexShrink: 0,
                }}
              />
            )}
          </button>

          {filtersOpen && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                right: 0,
                minWidth: 180,
                background: "#ffffff",
                border: "1px solid var(--trackify-border)",
                borderRadius: 12,
                boxShadow: "0 8px 32px rgba(7,26,74,0.12)",
                padding: "6px",
                zIndex: 100,
              }}
            >
              <div
                style={{
                  padding: "6px 10px",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--trackify-text-secondary)",
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                }}
              >
                Status
              </div>
              {statusFilters.map((f) => (
                <button
                  key={f.key}
                  onClick={() => {
                    setStatusFilter(f.key);
                    setCurrentPage(1);
                    setFiltersOpen(false);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    width: "100%",
                    padding: "7px 10px",
                    borderRadius: 8,
                    border: "none",
                    background: statusFilter === f.key ? "#EEF4FF" : "transparent",
                    color: statusFilter === f.key ? "#2455D6" : "var(--trackify-text)",
                    fontSize: 13,
                    fontWeight: statusFilter === f.key ? 600 : 400,
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "all 0.15s ease",
                  }}
                  onMouseEnter={(e) => {
                    if (statusFilter !== f.key) e.currentTarget.style.background = "#F5F8FE";
                  }}
                  onMouseLeave={(e) => {
                    if (statusFilter !== f.key) e.currentTarget.style.background = "transparent";
                  }}
                >
                  {f.label}
                  {statusFilter === f.key && (
                    <CheckCircle2 size={13} style={{ color: "#2455D6" }} />
                  )}
                </button>
              ))}
              {statusFilter !== "all" && (
                <>
                  <div style={{ height: 1, background: "var(--trackify-border)", margin: "4px 6px" }} />
                  <button
                    onClick={() => {
                      setStatusFilter("all");
                      setCurrentPage(1);
                      setFiltersOpen(false);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      width: "100%",
                      padding: "7px 10px",
                      borderRadius: 8,
                      border: "none",
                      background: "transparent",
                      color: "#DC2626",
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "#FEF2F2"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  >
                    <X size={13} /> Clear filter
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="ops-table-wrapper">
        <table className="ops-table">
          <thead>
            <tr>
              <th>Trip Ticket</th>
              <th>Date</th>
              <th>Customer</th>
              <th>Origin</th>
              <th>Destination</th>
              <th>Driver</th>
              <th>Vehicle</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {paginated.length === 0 ? (
              <tr>
                <td colSpan={9}>
                  <div className="ops-empty">
                    <div className="ops-empty-icon"><FileText size={32} /></div>
                    <div className="ops-empty-title">No trips found</div>
                    <div className="ops-empty-desc">
                      {search ? "Try adjusting your search criteria" : "No trips match the selected filter"}
                    </div>
                  </div>
                </td>
              </tr>
            ) : (
              paginated.map((trip) => {
                const actions = getActions(trip.status);
                return (
                  <tr key={trip.id}>
                    <td>
                      <span
                        className="ops-ticket-no"
                        onClick={() => onViewTrip(trip)}
                      >
                        {trip.ticketNo}
                      </span>
                    </td>
                    <td>{new Date(trip.scheduledDeparture).toLocaleDateString()}</td>
                    <td>{trip.customer}</td>
                    <td>{trip.origin}</td>
                    <td>{trip.destination}</td>
                    <td>{trip.driver || "—"}</td>
                    <td>{trip.vehicle || "—"}</td>
                    <td><TripStatusBadge status={trip.status} /></td>
                    <td>
                      <div style={{ display: "flex", gap: 4 }}>
                        {actions.map((a) => (
                          <button
                            key={a.key}
                            className="ops-btn ops-btn-ghost"
                            style={{ padding: "4px 8px", fontSize: 12 }}
                            onClick={() => {
                              if (a.key === "view" || a.key === "track" || a.key === "pod") {
                                onViewTrip(trip);
                              } else if (a.key === "assign" || a.key === "reassign") {
                                onViewTrip(trip);
                              }
                            }}
                            title={a.label}
                          >
                            <a.icon size={13} />
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 20px", borderTop: "1px solid var(--trackify-border-soft)" }}>
        <span style={{ fontSize: 12, color: "var(--trackify-text-secondary)" }}>
          Showing {((currentPage - 1) * perPage) + 1} to {Math.min(currentPage * perPage, filtered.length)} of {filtered.length} entries
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: "var(--trackify-text-secondary)" }}>Rows per page</span>
          <select
            value={perPage}
            disabled
            style={{
              padding: "4px 8px",
              border: "1px solid var(--trackify-border)",
              borderRadius: 6,
              fontSize: 12,
              color: "var(--trackify-text)",
              background: "#F8FAFD",
              cursor: "not-allowed",
            }}
          >
            <option value={10}>10</option>
          </select>
          <div style={{ display: "flex", gap: 2, marginLeft: 8 }}>
            <button
              className="ops-btn ops-btn-ghost"
              style={{ padding: "4px 8px", fontSize: 12, minWidth: 32, justifyContent: "center" }}
              disabled={currentPage === 1}
              onClick={() => setCurrentPage(currentPage - 1)}
            >
              ‹
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
              <button
                key={page}
                className={`ops-btn ${page === currentPage ? "ops-btn-primary" : "ops-btn-ghost"}`}
                style={{ padding: "4px 8px", fontSize: 12, minWidth: 32, justifyContent: "center" }}
                onClick={() => setCurrentPage(page)}
              >
                {page}
              </button>
            ))}
            <button
              className="ops-btn ops-btn-ghost"
              style={{ padding: "4px 8px", fontSize: 12, minWidth: 32, justifyContent: "center" }}
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage(currentPage + 1)}
            >
              ›
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---- small modals used by the trip action bar ---- */

function Backdrop({ children, onClose }) {
  return (
    <div
      onMouseDown={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(7,26,74,0.28)", display: "flex",
        alignItems: "flex-start", justifyContent: "center", padding: "70px 20px", zIndex: 9000 }}
    >
      <div onMouseDown={(e) => e.stopPropagation()} className="ops-card" style={{ width: "100%", maxWidth: 440, padding: 20 }}>
        {children}
      </div>
    </div>
  );
}

function ReasonModal({ title, prompt, busy, onClose, onSubmit }) {
  const [text, setText] = useState("");
  return (
    <Backdrop onClose={onClose}>
      <h3 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 700 }}>{title}</h3>
      <p style={{ fontSize: 13, color: "var(--trackify-text-secondary)", margin: "0 0 12px" }}>{prompt}</p>
      <textarea className="ops-form-input ops-form-textarea" autoFocus value={text}
        onChange={(e) => setText(e.target.value)} placeholder="Reason…" />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <button className="ops-back-btn" onClick={onClose}>Cancel</button>
        <button className="ops-btn ops-btn-danger" disabled={busy || !text.trim()} onClick={() => onSubmit(text.trim())}>
          {busy ? "Working…" : "Confirm"}
        </button>
      </div>
    </Backdrop>
  );
}

function PodModal({ busy, onClose, onSubmit }) {
  const [receivedBy, setReceivedBy] = useState("");
  const [remarks, setRemarks] = useState("");
  return (
    <Backdrop onClose={onClose}>
      <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 700 }}>Confirm delivery</h3>
      <div className="ops-form-group">
        <label className="ops-form-label">Received by *</label>
        <input className="ops-form-input" autoFocus value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} placeholder="Name of consignee" />
      </div>
      <div className="ops-form-group">
        <label className="ops-form-label">Remarks</label>
        <textarea className="ops-form-input ops-form-textarea" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <button className="ops-back-btn" onClick={onClose}>Cancel</button>
        <button className="ops-btn ops-btn-primary" disabled={busy || !receivedBy.trim()} onClick={() => onSubmit({ receivedBy: receivedBy.trim(), remarks: remarks.trim() })}>
          {busy ? "Working…" : "Confirm delivery"}
        </button>
      </div>
    </Backdrop>
  );
}

function AssignModal({ busy, onClose, onSubmit }) {
  const [res, setRes] = useState({ drivers: [], vehicles: [] });
  const [driverId, setDriverId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAssignableResources().then(setRes).catch(() => setRes({ drivers: [], vehicles: [] })).finally(() => setLoading(false));
  }, []);

  return (
    <Backdrop onClose={onClose}>
      <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 700 }}>Assign driver &amp; vehicle</h3>
      {loading ? (
        <p style={{ fontSize: 13, color: "var(--trackify-text-secondary)" }}>Loading available resources…</p>
      ) : (
        <>
          <div className="ops-form-group">
            <label className="ops-form-label">Driver *</label>
            <select className="ops-form-input" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
              <option value="">— Select an available driver —</option>
              {res.drivers.map((d) => <option key={d.id} value={d.id}>{d.label} · {d.sub}</option>)}
            </select>
          </div>
          <div className="ops-form-group">
            <label className="ops-form-label">Vehicle *</label>
            <select className="ops-form-input" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              <option value="">— Select an available vehicle —</option>
              {res.vehicles.map((v) => <option key={v.id} value={v.id}>{v.label} · {v.sub}</option>)}
            </select>
          </div>
          {(!res.drivers.length || !res.vehicles.length) && (
            <p style={{ fontSize: 12, color: "#B45309" }}>No available {!res.drivers.length ? "drivers" : "vehicles"} right now.</p>
          )}
        </>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <button className="ops-back-btn" onClick={onClose}>Cancel</button>
        <button className="ops-btn ops-btn-primary" disabled={busy || !driverId || !vehicleId}
          onClick={() => onSubmit({ driverId: Number(driverId), vehicleId: Number(vehicleId) })}>
          {busy ? "Working…" : "Assign"}
        </button>
      </div>
    </Backdrop>
  );
}

function TripDetails({ trip: initialTrip, onBack, onChanged }) {
  const { addToast } = useToast();
  const { can } = usePermissions();
  const [trip, setTrip] = useState(initialTrip);
  const [activeTab, setActiveTab] = useState("overview");
  const [activities, setActivities] = useState([]);
  const [busy, setBusy] = useState(null);
  const [modal, setModal] = useState(null); // {action, reason?, pod?} | {action:'assign'}
  const tabs = ["overview", "route", "assignment", "cargo", "activity"];

  const refresh = useCallback(async () => {
    try {
      const fresh = await getTripById(initialTrip.id);
      setTrip(fresh);
      setActivities(fresh.history || []);
    } catch {
      /* keep what we have */
    }
  }, [initialTrip.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function run(action, body) {
    setBusy(action);
    try {
      const res = await ACTION_FN[action](trip.id, body);
      addToast(res?.message || "Done", "success");
      setModal(null);
      await refresh();
      onChanged?.();
    } catch (err) {
      addToast(err.message || "Action failed", "error");
    } finally {
      setBusy(null);
    }
  }

  const steps = WORKFLOW[trip.status] || [];
  const visibleSteps = steps.filter((s) => can(s.perm));
  const canCancel = CANCELLABLE.includes(trip.status) && can("trip.cancel");
  const allSteps = steps.length + (CANCELLABLE.includes(trip.status) ? 1 : 0);
  const nextStepHint =
    steps.length && !visibleSteps.length
      ? `This trip is ${trip.status.replace(/_/g, " ")} — the next action (${steps.map((s) => s.label).join(" / ")}) is done by another role.`
      : !steps.length
      ? `This trip is ${trip.status.replace(/_/g, " ")}. No workflow actions at this stage.`
      : null;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <button className="ops-back-btn" onClick={onBack}>
          <ArrowLeft size={15} /> Back
        </button>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--trackify-text)", margin: 0 }}>
            {trip.ticketNo}
          </h2>
          <span style={{ fontSize: 13, color: "var(--trackify-text-secondary)" }}>
            {trip.customer}
          </span>
        </div>
        <div style={{ marginLeft: "auto" }}>
          <TripStatusBadge status={trip.status} />
        </div>
      </div>

      <div
        className="ops-card"
        style={{ display: "flex", gap: 8, alignItems: "center", padding: "12px 16px", marginBottom: 14, flexWrap: "wrap" }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--trackify-text-secondary)", marginRight: 4 }}>
          Actions
        </span>
        {nextStepHint && (
          <span style={{ fontSize: 12, color: "var(--trackify-text-secondary)" }}>{nextStepHint}</span>
        )}
        {visibleSteps.map((s) => (
            <button
              key={s.k + s.label}
              className={`ops-btn ${s.kind === "primary" ? "ops-btn-primary" : s.kind === "danger" ? "ops-btn-danger" : "ops-btn-secondary"}`}
              disabled={busy !== null}
              onClick={() => {
                if (s.k === "assign") setModal({ action: "assign" });
                else if (s.reason) setModal({ action: s.k, reason: s.reason });
                else if (s.pod) setModal({ action: s.k, pod: true });
                else run(s.k);
              }}
            >
              {busy === s.k ? "Working…" : s.label}
            </button>
          ))}
          {canCancel && (
            <button
              className="ops-btn ops-btn-danger"
              style={{ marginLeft: "auto" }}
              disabled={busy !== null}
              onClick={() => setModal({ action: "cancel", reason: "Why is this trip being cancelled?" })}
            >
              Cancel trip
            </button>
          )}
        </div>

      {modal?.reason && (
        <ReasonModal
          title={modal.action === "cancel" ? "Cancel trip" : "Reject trip"}
          prompt={modal.reason}
          busy={busy !== null}
          onClose={() => setModal(null)}
          onSubmit={(text) => run(modal.action, { reason: text })}
        />
      )}
      {modal?.pod && (
        <PodModal
          busy={busy !== null}
          onClose={() => setModal(null)}
          onSubmit={(body) => run("deliver", body)}
        />
      )}
      {modal?.action === "assign" && (
        <AssignModal
          busy={busy !== null}
          onClose={() => setModal(null)}
          onSubmit={async (body) => {
            setBusy("assign");
            try {
              const res = await assignTrip(trip.id, body);
              addToast(res?.message || "Driver and vehicle assigned", "success");
              setModal(null);
              await refresh();
              onChanged?.();
            } catch (e) {
              addToast(e.message || "Assignment failed", "error");
            } finally {
              setBusy(null);
            }
          }}
        />
      )}

      <div className="ops-card">
        <div className="ops-tabs">
          {tabs.map((tab) => (
            <button
              key={tab}
              className={`ops-tab ${activeTab === tab ? "active" : ""}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab === "activity" ? "Timeline" : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        <div style={{ padding: 20 }}>
          {activeTab === "overview" && (
            <div>
              <h3 className="ops-section-title">Trip Information</h3>
              <div className="ops-detail-grid">
                <div className="ops-detail-item">
                  <span className="ops-detail-label">Ticket No</span>
                  <span className="ops-detail-value">{trip.ticketNo}</span>
                </div>
                <div className="ops-detail-item">
                  <span className="ops-detail-label">Customer</span>
                  <span className="ops-detail-value">{trip.customer}</span>
                </div>
                <div className="ops-detail-item">
                  <span className="ops-detail-label">Purpose</span>
                  <span className="ops-detail-value">{trip.purpose}</span>
                </div>
                <div className="ops-detail-item">
                  <span className="ops-detail-label">Status</span>
                  <TripStatusBadge status={trip.status} />
                </div>
                <div className="ops-detail-item">
                  <span className="ops-detail-label">Scheduled Departure</span>
                  <span className="ops-detail-value">
                    {new Date(trip.scheduledDeparture).toLocaleString()}
                  </span>
                </div>
                <div className="ops-detail-item">
                  <span className="ops-detail-label">Scheduled Arrival</span>
                  <span className="ops-detail-value">
                    {new Date(trip.scheduledArrival).toLocaleString()}
                  </span>
                </div>
                {trip.actualDeparture && (
                  <div className="ops-detail-item">
                    <span className="ops-detail-label">Actual Departure</span>
                    <span className="ops-detail-value">
                      {new Date(trip.actualDeparture).toLocaleString()}
                    </span>
                  </div>
                )}
                {trip.actualArrival && (
                  <div className="ops-detail-item">
                    <span className="ops-detail-label">Actual Arrival</span>
                    <span className="ops-detail-value">
                      {new Date(trip.actualArrival).toLocaleString()}
                    </span>
                  </div>
                )}
              </div>

              {trip.approvedBy && (
                <>
                  <h3 className="ops-section-title" style={{ marginTop: 20 }}>Approval</h3>
                  <div className="ops-detail-grid">
                    <div className="ops-detail-item">
                      <span className="ops-detail-label">Approved By</span>
                      <span className="ops-detail-value">{trip.approvedBy}</span>
                    </div>
                    <div className="ops-detail-item">
                      <span className="ops-detail-label">Approved At</span>
                      <span className="ops-detail-value">
                        {trip.approvedAt ? new Date(trip.approvedAt).toLocaleString() : "—"}
                      </span>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === "route" && (
            <div>
              <h3 className="ops-section-title">Route Details</h3>
              <div className="ops-detail-grid">
                <div className="ops-detail-item">
                  <span className="ops-detail-label">Origin</span>
                  <span className="ops-detail-value">{trip.origin}</span>
                </div>
                <div className="ops-detail-item">
                  <span className="ops-detail-label">Destination</span>
                  <span className="ops-detail-value">{trip.destination}</span>
                </div>
              </div>
              {trip.intermediateStops && trip.intermediateStops.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <span className="ops-detail-label">Intermediate Stops</span>
                  <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                    {trip.intermediateStops.map((stop, i) => (
                      <span
                        key={i}
                        style={{
                          padding: "3px 10px",
                          background: "#F5F8FE",
                          border: "1px solid var(--trackify-border)",
                          borderRadius: 6,
                          fontSize: 12,
                          color: "var(--trackify-text)",
                        }}
                      >
                        {stop}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === "assignment" && (
            <div>
              <h3 className="ops-section-title">Driver & Vehicle Assignment</h3>
              <div className="ops-detail-grid">
                <div className="ops-detail-item">
                  <span className="ops-detail-label">Driver</span>
                  <span className="ops-detail-value">{trip.driver || "Not assigned"}</span>
                </div>
                <div className="ops-detail-item">
                  <span className="ops-detail-label">Vehicle</span>
                  <span className="ops-detail-value">{trip.vehicle || "Not assigned"}</span>
                </div>
              </div>
            </div>
          )}

          {activeTab === "cargo" && (
            <div>
              <h3 className="ops-section-title">Cargo Information</h3>
              <div className="ops-detail-grid">
                <div className="ops-detail-item">
                  <span className="ops-detail-label">Description</span>
                  <span className="ops-detail-value">{trip.cargoDescription}</span>
                </div>
                <div className="ops-detail-item">
                  <span className="ops-detail-label">Quantity</span>
                  <span className="ops-detail-value">{trip.cargoQuantity ?? "—"} units</span>
                </div>
                <div className="ops-detail-item">
                  <span className="ops-detail-label">Weight</span>
                  <span className="ops-detail-value">{trip.cargoWeight != null ? trip.cargoWeight.toLocaleString() : "—"} kg</span>
                </div>
                <div className="ops-detail-item">
                  <span className="ops-detail-label">Special Handling</span>
                  <span className="ops-detail-value">{trip.specialHandling}</span>
                </div>
              </div>
              {trip.dispatchNotes && (
                <div style={{ marginTop: 12 }}>
                  <span className="ops-detail-label">Dispatch Notes</span>
                  <p style={{ fontSize: 13, color: "var(--trackify-text)", margin: "4px 0 0" }}>
                    {trip.dispatchNotes}
                  </p>
                </div>
              )}
              {trip.specialInstructions && (
                <div style={{ marginTop: 12 }}>
                  <span className="ops-detail-label">Special Instructions</span>
                  <p style={{ fontSize: 13, color: "var(--trackify-text)", margin: "4px 0 0" }}>
                    {trip.specialInstructions}
                  </p>
                </div>
              )}
            </div>
          )}

          {activeTab === "activity" && (
            <div>
              <h3 className="ops-section-title">Activity Log</h3>
              {activities.length === 0 ? (
                <div className="ops-empty" style={{ padding: 24 }}>
                  <div className="ops-empty-desc">No activity recorded yet</div>
                </div>
              ) : (
                <div>
                  {activities.map((a, i) => (
                    <div key={i} className="ops-activity-item">
                      <div className="ops-activity-dot" />
                      <div className="ops-activity-content">
                        <div className="ops-activity-action">{a.action}</div>
                        <div className="ops-activity-details">{a.details}</div>
                        <div className="ops-activity-time">
                          {new Date(a.timestamp).toLocaleString()} · {a.user}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CreateTrip({ onBack, onCreated }) {
  const { addToast } = useToast();
  const [customers, setCustomers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    customer: "",
    purpose: "",
    origin: "",
    destination: "",
    intermediateStops: "",
    scheduledDeparture: "",
    scheduledArrival: "",
    cargoDescription: "",
    cargoQuantity: "",
    cargoWeight: "",
    specialHandling: "",
    dispatchNotes: "",
    specialInstructions: "",
  });

  useEffect(() => {
    searchCustomers("").then(setCustomers).catch(() => setCustomers([]));
  }, []);

  const handleChange = (field) => (e) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await createTrip({
        customerId: form.customer ? Number(form.customer) : null,
        purpose: form.purpose,
        origin: form.origin,
        destination: form.destination,
        scheduledDeparture: toSqlDateTime(form.scheduledDeparture),
        scheduledArrival: toSqlDateTime(form.scheduledArrival),
        cargoDescription: form.cargoDescription || null,
        cargoQuantity: form.cargoQuantity ? Number(form.cargoQuantity) : null,
        cargoWeight: form.cargoWeight ? Number(form.cargoWeight) : null,
        specialHandling: form.specialHandling || null,
        dispatchNotes: form.dispatchNotes || null,
        specialInstructions: form.specialInstructions || null,
      });
      addToast(
        `Trip ${res?.data?.ticketNo || res?.data?.ticket_no || "draft"} created`,
        "success"
      );
      (onCreated || onBack)();
    } catch (err) {
      addToast(err.message || "Failed to create trip", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ops-form-container">
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <button className="ops-back-btn" onClick={onBack}>
          <ArrowLeft size={15} /> Back
        </button>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--trackify-text)", margin: 0 }}>
          Create Trip
        </h2>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="ops-card" style={{ marginBottom: 16 }}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--trackify-border-soft)", background: "#FAFBFE", borderRadius: "16px 16px 0 0" }}>
            <h3 className="ops-section-title" style={{ margin: 0, border: "none", padding: 0, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 28, height: 28, borderRadius: 8, background: "#EEF4FF", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                <ClipboardCheck size={14} style={{ color: "#2455D6" }} />
              </span>
              Trip Information
            </h3>
          </div>
          <div style={{ padding: 20 }}>
            <div className="ops-form-row">
              <div className="ops-form-group">
                <label className="ops-form-label">Customer</label>
                <select
                  className="ops-form-input"
                  value={form.customer}
                  onChange={handleChange("customer")}
                >
                  <option value="">— Select customer —</option>
                  {customers.map((c) => (
                    <option key={c.customer_id} value={c.customer_id}>
                      {c.customer_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="ops-form-group">
                <label className="ops-form-label">Trip Purpose *</label>
                <input
                  className="ops-form-input"
                  type="text"
                  placeholder="e.g. Goods Delivery"
                  value={form.purpose}
                  onChange={handleChange("purpose")}
                  required
                />
              </div>
            </div>
            <div className="ops-form-row">
              <div className="ops-form-group">
                <label className="ops-form-label">Scheduled Departure *</label>
                <input
                  className="ops-form-input"
                  type="datetime-local"
                  value={form.scheduledDeparture}
                  onChange={handleChange("scheduledDeparture")}
                  required
                />
              </div>
              <div className="ops-form-group">
                <label className="ops-form-label">Scheduled Arrival *</label>
                <input
                  className="ops-form-input"
                  type="datetime-local"
                  value={form.scheduledArrival}
                  onChange={handleChange("scheduledArrival")}
                  required
                />
              </div>
            </div>
          </div>
        </div>

        <div className="ops-card" style={{ marginBottom: 16 }}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--trackify-border-soft)", background: "#FAFBFE", borderRadius: "16px 16px 0 0" }}>
            <h3 className="ops-section-title" style={{ margin: 0, border: "none", padding: 0, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 28, height: 28, borderRadius: 8, background: "#EEF4FF", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                <MapPin size={14} style={{ color: "#2455D6" }} />
              </span>
              Route
            </h3>
          </div>
          <div style={{ padding: 20 }}>
            <div className="ops-form-row">
              <div className="ops-form-group">
                <label className="ops-form-label">Origin *</label>
                <input
                  className="ops-form-input"
                  type="text"
                  placeholder="Enter origin city"
                  value={form.origin}
                  onChange={handleChange("origin")}
                  required
                />
              </div>
              <div className="ops-form-group">
                <label className="ops-form-label">Destination *</label>
                <input
                  className="ops-form-input"
                  type="text"
                  placeholder="Enter destination city"
                  value={form.destination}
                  onChange={handleChange("destination")}
                  required
                />
              </div>
            </div>
            <div className="ops-form-group">
              <label className="ops-form-label">Intermediate Stops</label>
              <input
                className="ops-form-input"
                type="text"
                placeholder="Comma-separated stops (e.g. Bansalan, Magsaysay)"
                value={form.intermediateStops}
                onChange={handleChange("intermediateStops")}
              />
            </div>
          </div>
        </div>

        <div className="ops-card" style={{ marginBottom: 16 }}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--trackify-border-soft)", background: "#FAFBFE", borderRadius: "16px 16px 0 0" }}>
            <h3 className="ops-section-title" style={{ margin: 0, border: "none", padding: 0, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 28, height: 28, borderRadius: 8, background: "#EEF4FF", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                <Package size={14} style={{ color: "#2455D6" }} />
              </span>
              Cargo / Delivery Information
            </h3>
          </div>
          <div style={{ padding: 20 }}>
            <div className="ops-form-row">
              <div className="ops-form-group">
                <label className="ops-form-label">Cargo Description *</label>
                <input
                  className="ops-form-input"
                  type="text"
                  placeholder="Describe the cargo"
                  value={form.cargoDescription}
                  onChange={handleChange("cargoDescription")}
                  required
                />
              </div>
              <div className="ops-form-group">
                <label className="ops-form-label">Special Handling</label>
                <input
                  className="ops-form-input"
                  type="text"
                  placeholder="e.g. Fragile, Refrigerated"
                  value={form.specialHandling}
                  onChange={handleChange("specialHandling")}
                />
              </div>
            </div>
            <div className="ops-form-row">
              <div className="ops-form-group">
                <label className="ops-form-label">Quantity (units)</label>
                <input
                  className="ops-form-input"
                  type="number"
                  placeholder="0"
                  value={form.cargoQuantity}
                  onChange={handleChange("cargoQuantity")}
                />
              </div>
              <div className="ops-form-group">
                <label className="ops-form-label">Weight (kg)</label>
                <input
                  className="ops-form-input"
                  type="number"
                  placeholder="0"
                  value={form.cargoWeight}
                  onChange={handleChange("cargoWeight")}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="ops-card" style={{ marginBottom: 16 }}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--trackify-border-soft)", background: "#FAFBFE", borderRadius: "16px 16px 0 0" }}>
            <h3 className="ops-section-title" style={{ margin: 0, border: "none", padding: 0, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 28, height: 28, borderRadius: 8, background: "#EEF4FF", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                <FileText size={14} style={{ color: "#2455D6" }} />
              </span>
              Notes & Instructions
            </h3>
          </div>
          <div style={{ padding: 20 }}>
            <div className="ops-form-group">
              <label className="ops-form-label">Dispatch Notes</label>
              <textarea
                className="ops-form-input ops-form-textarea"
                placeholder="Dispatch notes..."
                value={form.dispatchNotes}
                onChange={handleChange("dispatchNotes")}
              />
            </div>
            <div className="ops-form-group">
              <label className="ops-form-label">Special Instructions</label>
              <textarea
                className="ops-form-input ops-form-textarea"
                placeholder="Special instructions for this trip..."
                value={form.specialInstructions}
                onChange={handleChange("specialInstructions")}
              />
            </div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="ops-back-btn" onClick={onBack}>
            Cancel
          </button>
          <button type="submit" className="ops-btn ops-btn-primary" style={{ borderRadius: 10 }} disabled={saving}>
            {saving ? "Saving…" : "Save Draft"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function TripsPage() {
  const [view, setView] = useState("list");
  const [selectedTrip, setSelectedTrip] = useState(null);
  const [trips, setTrips] = useState([]);
  const [stats, setStats] = useState({ total: 0, draft: 0, pending: 0, inTransit: 0, delivered: 0 });

  const loadData = useCallback(() => {
    getAllTrips().then(setTrips).catch(() => setTrips([]));
    getTripStats().then(setStats).catch(() => {});
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleViewTrip = (trip) => {
    setSelectedTrip(trip);
    setView("details");
  };

  return (
    <div className="ops-page">
      <TopNav />
      <div className="ops-container">
        <div className="ops-header">
          <div className="ops-header-left">
            <h1 className="ops-title">Trips</h1>
            <p className="ops-subtitle">Manage and track all trip tickets</p>
          </div>
          <div className="ops-header-actions">
            <Can permission="trip.create">
              <button
                className="ops-btn ops-btn-primary"
                onClick={() => setView("create")}
              >
                <Plus size={15} /> Create Trip
              </button>
            </Can>
          </div>
        </div>

        {view === "list" && (
          <>
            <div className="ops-stats-bar">
              <OpsStatCard icon={Layers} label="Total" count={stats.total} color="#2455D6" bg="#EEF4FF" />
              <OpsStatCard icon={FileText} label="Draft" count={stats.draft} color="#64748B" bg="#F1F5F9" />
              <OpsStatCard icon={Clock} label="Pending" count={stats.pending} color="#B45309" bg="#FFF8E1" />
              <OpsStatCard icon={CircleDot} label="In Transit" count={stats.inTransit} color="#1D4ED8" bg="#DBEAFE" />
              <OpsStatCard icon={CheckCircle} label="Delivered" count={stats.delivered} color="#15803D" bg="#DCFCE7" />
            </div>
            <TripList trips={trips} onViewTrip={handleViewTrip} />
          </>
        )}

        {view === "details" && selectedTrip && (
          <TripDetails trip={selectedTrip} onBack={() => setView("list")} onChanged={loadData} />
        )}

        {view === "create" && (
          <CreateTrip
            onBack={() => setView("list")}
            onCreated={() => { loadData(); setView("list"); }}
          />
        )}
      </div>
    </div>
  );
}
