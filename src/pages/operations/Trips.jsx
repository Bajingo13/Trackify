import { useState, useMemo, useRef, useEffect } from "react";
import {
  Search, Plus, Filter, ChevronDown, Eye, Edit3, Send, UserPlus,
  MapPin, ClipboardCheck, X, ArrowLeft, Calendar, Package, Truck,
  FileText, Clock, CheckCircle2, Activity, Layers, CircleDot, CheckCircle,
} from "lucide-react";
import TopNav from "../../components/dashboard/TopNav";
import TripStatusBadge from "../../components/operations/TripStatusBadge";
import OpsStatCard from "../../components/operations/OpsStatCard";
import { getAllTrips, getTripById, getTripActivities, getTripStats } from "../../services/operations/tripService";
import "../../styles/operations.css";

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

function TripDetails({ trip, onBack }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [activities, setActivities] = useState([]);
  const tabs = ["overview", "route", "assignment", "cargo", "activity"];

  useEffect(() => {
    getTripActivities(trip.id).then(setActivities).catch(() => setActivities([]));
  }, [trip.id]);

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

      <div className="ops-card">
        <div className="ops-tabs">
          {tabs.map((tab) => (
            <button
              key={tab}
              className={`ops-tab ${activeTab === tab ? "active" : ""}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
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

function CreateTrip({ onBack }) {
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

  const handleChange = (field) => (e) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    alert("Trip saved as draft. (Mock action)");
    onBack();
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
                <label className="ops-form-label">Customer *</label>
                <input
                  className="ops-form-input"
                  type="text"
                  placeholder="Enter customer name"
                  value={form.customer}
                  onChange={handleChange("customer")}
                  required
                />
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
          <button type="submit" className="ops-btn ops-btn-primary" style={{ borderRadius: 10 }}>
            Save Draft
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

  useEffect(() => {
    getAllTrips().then(setTrips).catch(() => setTrips([]));
    getTripStats().then(setStats).catch(() => {});
  }, []);

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
            <button
              className="ops-btn ops-btn-primary"
              onClick={() => setView("create")}
            >
              <Plus size={15} /> Create Trip
            </button>
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
          <TripDetails trip={selectedTrip} onBack={() => setView("list")} />
        )}

        {view === "create" && (
          <CreateTrip onBack={() => setView("list")} />
        )}
      </div>
    </div>
  );
}
