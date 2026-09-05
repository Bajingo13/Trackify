import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import AppShell from "../../components/layout/AppShell";
import { useAutoRefresh, relativeTime } from "../../hooks/useAutoRefresh";
import {
  Search, Truck, User, MapPin, Calendar, Clock, AlertTriangle,
  CheckCircle2, XCircle, ArrowRight, RotateCcw, Filter, ChevronDown, X, FileText,
} from "lucide-react";
import TripStatusBadge from "../../components/operations/TripStatusBadge";
import OpsStatCard from "../../components/operations/OpsStatCard";
import { getDispatchBoard, validateAssignment, assignTrip, fmtDate, fmtDateTime } from "../../services/operations/dispatchService";
import { useRealtime } from "../../services/realtime";
import VehicleCard from "../../components/fleet/VehicleCard";
import { useToast } from "../../components/shared/Toast";
import "../../styles/operations.css";

const V_STYLE = {
  pass: { cls: "ops-validation-passed", Icon: CheckCircle2, color: "#15803D" },
  fail: { cls: "ops-validation-failed", Icon: XCircle, color: "#B91C1C" },
  warn: { cls: "ops-validation-failed", Icon: AlertTriangle, color: "#B45309" },
  pending: { cls: "", Icon: Clock, color: "var(--trackify-text-muted)" },
};

function AssignmentPanel({ trip, drivers, vehicles, onClose, onAssign }) {
  const [selectedDriver, setSelectedDriver] = useState(null);
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const validation = useMemo(() => {
    return validateAssignment(trip, selectedDriver, selectedVehicle);
  }, [trip, selectedDriver, selectedVehicle]);

  return (
    <div className="ops-modal-overlay" onClick={onClose}>
      <div className="ops-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 780 }}>
        <div className="ops-modal-header">
          <div>
            <h3 className="ops-modal-title">Assign Resources</h3>
            <span style={{ fontSize: 13, color: "var(--trackify-text-secondary)" }}>
              {trip.ticketNo} — {trip.customer}
            </span>
          </div>
          <button className="ops-btn ops-btn-ghost" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="ops-modal-body">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div>
              <h4 className="ops-section-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <User size={14} /> Select Driver
              </h4>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflowY: "auto" }}>
                {drivers.map((d) => (
                  <div
                    key={d.id}
                    className={`ops-dispatch-card ${selectedDriver?.id === d.id ? "selected" : ""}`}
                    onClick={() => setSelectedDriver(d)}
                    style={{ padding: "10px 12px" }}
                  >
                    <div className="ops-dispatch-card-title">{d.name}</div>
                    <div className="ops-dispatch-card-detail">
                      Licence: {d.licenseNo}{d.licenseType ? ` · ${d.licenseType}` : ""}
                    </div>
                    <div className="ops-dispatch-card-detail">
                      Expires: {fmtDate(d.licenseExpiry)}
                      {d.licenseExpiry && new Date(d.licenseExpiry) < new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) && (
                        <span style={{ color: "#B45309", marginLeft: 4, fontWeight: 600 }}>Expiring soon</span>
                      )}
                    </div>
                    <div className="ops-dispatch-card-detail">
                      {d.employeeNo || "—"}{d.phone ? ` · ${d.phone}` : ""}
                    </div>
                  </div>
                ))}
                {drivers.length === 0 && (
                  <div className="ops-empty" style={{ padding: 16 }}>
                    <div className="ops-empty-desc">No available drivers</div>
                  </div>
                )}
              </div>
            </div>

            <div>
              <h4 className="ops-section-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Truck size={14} /> Select Vehicle
              </h4>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 260, overflowY: "auto" }}>
                {vehicles.map((v) => (
                  <VehicleCard
                    key={v.id}
                    variant="compact"
                    vehicle={toVehicleCard(v)}
                    loadKg={trip?.cargoWeight ?? null}
                    selected={selectedVehicle?.id === v.id}
                    onClick={() => setSelectedVehicle(v)}
                    footer={
                      <div className="ops-dispatch-card-detail" style={{ fontSize: 11 }}>
                        Reg: {fmtDate(v.registrationExpiry)}
                      </div>
                    }
                  />
                ))}
                {vehicles.length === 0 && (
                  <div className="ops-empty" style={{ padding: 16 }}>
                    <div className="ops-empty-desc">No available vehicles</div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div style={{ marginTop: 20 }}>
            <h4 className="ops-section-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <CheckCircle2 size={14} /> Assignment Validation
            </h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {validation.checks.map((check, i) => {
                const s = V_STYLE[check.state] || V_STYLE.pending;
                const Icon = s.Icon;
                return (
                  <div
                    key={i}
                    className={`ops-validation-item ${s.cls}`}
                    style={s.cls ? undefined : { border: "1px solid var(--trackify-border)", background: "var(--trackify-surface)", opacity: 0.75 }}
                  >
                    <Icon size={15} style={{ color: s.color, flexShrink: 0 }} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 12 }}>{check.label}</div>
                      <div style={{ fontSize: 11, opacity: 0.8 }}>{check.message}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{
              marginTop: 12,
              padding: "10px 14px",
              borderRadius: 8,
              background: validation.ready ? "#DCFCE7" : "#FEF2F2",
              color: validation.ready ? "#15803D" : "#B91C1C",
              fontSize: 13,
              fontWeight: 600,
              textAlign: "center",
            }}>
              {validation.ready
                ? "Ready for assignment"
                : !selectedDriver || !selectedVehicle
                  ? "Select a driver and a vehicle to continue"
                  : "Assignment blocked — fix the issues above"}
            </div>
          </div>
        </div>

        <div className="ops-modal-footer">
          <button className="ops-btn ops-btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="ops-btn ops-btn-primary"
            disabled={!validation.ready}
            onClick={() => {
              if (validation.ready) {
                onAssign(trip, selectedDriver, selectedVehicle);
                onClose();
              }
            }}
          >
            {validation.ready ? "Confirm Assignment" : "Assign"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DispatchTripCard({ trip, onClick }) {
  return (
    <div className="ops-dispatch-card" onClick={onClick}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div className="ops-dispatch-card-title">{trip.ticketNo}</div>
          <div className="ops-dispatch-card-detail" style={{ fontWeight: 500 }}>{trip.customer}</div>
        </div>
        <TripStatusBadge status={trip.status} />
      </div>
      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--trackify-text-secondary)" }}>
          <MapPin size={12} style={{ flexShrink: 0 }} />
          <span>{trip.origin} → {trip.destination}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--trackify-text-secondary)" }}>
          <Calendar size={12} style={{ flexShrink: 0 }} />
          <span>{fmtDateTime(trip.scheduledDeparture)}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--trackify-text-secondary)" }}>
          <Truck size={12} style={{ flexShrink: 0 }} />
          <span>
            {trip.cargoDescription || "Cargo per trip ticket"}
            {trip.cargoWeight != null ? ` · ${trip.cargoWeight.toLocaleString()} kg` : ""}
            {trip.priority && trip.priority !== "normal" ? ` · ${trip.priority} priority` : ""}
          </span>
        </div>
      </div>
      <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--trackify-border-soft)", display: "flex", justifyContent: "flex-end" }}>
        <button className="ops-btn ops-btn-primary" style={{ padding: "5px 12px", fontSize: 12 }}>
          <ArrowRight size={13} /> Assign
        </button>
      </div>
    </div>
  );
}

function ResourceCard({ item, type, loadKg = null }) {
  if (type === "driver") {
    return (
      <div className="ops-dispatch-card">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10, background: "#EEF4FF",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <User size={16} style={{ color: "#2455D6" }} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="ops-dispatch-card-title">{item.name}</div>
            <div className="ops-dispatch-card-detail" style={{ fontSize: 11 }}>{item.employeeNo || item.phone || "—"}</div>
          </div>
        </div>
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 2 }}>
          <div className="ops-dispatch-card-detail">Licence: {item.licenseNo}</div>
          <div className="ops-dispatch-card-detail">
            Expires: {fmtDate(item.licenseExpiry)}
            {item.licenseExpiry && new Date(item.licenseExpiry) < new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) && (
              <span style={{ color: "#B45309", marginLeft: 4, fontWeight: 600 }}>•</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <VehicleCard
      variant="compact"
      vehicle={toVehicleCard(item)}
      loadKg={loadKg}
      footer={
        <div className="ops-dispatch-card-detail" style={{ fontSize: 11 }}>
          Reg: {fmtDate(item.registrationExpiry)}
        </div>
      }
    />
  );
}

/** dispatch-board vehicle shape -> the shape VehicleCard renders */
export function toVehicleCard(v = {}) {
  return {
    id: v.vehicle_id ?? v.id,
    plateNo: v.plateNo ?? "—",
    type: v.type ?? "—",
    brand: v.brand || "",
    model: v.model || "",
    capacityKg: v.capacity != null ? Number(v.capacity) : null,
    odometerReading: v.odometer != null ? Number(v.odometer) : 0,
    kmToService: v.kmToService ?? null,
    serviceStatus: v.serviceStatus ?? null,
    homeBranch: v.homeBranch || "",
    currentTrip: v.currentTrip || null,
    status: "Available",
  };
}

export default function DispatchPage() {
  const { addToast } = useToast();
  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState("all");
  const [sortBy, setSortBy] = useState("departure");
  const [assigningTrip, setAssigningTrip] = useState(null);
  const [saving, setSaving] = useState(false);
  const [boardData, setBoardData] = useState({ unassignedTrips: [], availableDrivers: [], availableVehicles: [] });

  const { unassignedTrips, availableDrivers, availableVehicles } = boardData;

  const load = useCallback(async () => {
    setBoardData(await getDispatchBoard());
  }, []);
  // A poll every 60s as a fallback; the WebSocket below is the primary path —
  // any assign/release/start/deliver/close/cancel refreshes the board instantly.
  const { refreshing, lastUpdated, refresh } = useAutoRefresh(load, 60000);
  const loadBoard = refresh;
  const [liveStatus, setLiveStatus] = useState("idle");
  useRealtime((msg) => { if (msg.type === "trip:status") load(); }, setLiveStatus);
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 15000);
    return () => clearInterval(id);
  }, []);

  async function handleAssign(trip, driver, vehicle) {
    const tripId = trip.trip_ticket_id ?? trip.id;
    const driverId = driver.driver_id ?? driver.id;
    const vehicleId = vehicle.vehicle_id ?? vehicle.id;
    setSaving(true);
    try {
      let res;
      try {
        res = await assignTrip(tripId, driverId, vehicleId);
      } catch (err) {
        if (err?.data?.code === "CROSS_BRANCH" && window.confirm(`${err.data.message}`)) {
          res = await assignTrip(tripId, driverId, vehicleId, { allowCrossBranch: true });
        } else {
          throw err;
        }
      }
      addToast(res?.message || "Trip assigned", "success");
      setAssigningTrip(null);
      loadBoard();
    } catch (err) {
      addToast(err.message || "Assignment failed", "error");
    } finally {
      setSaving(false);
    }
  }

  const filteredTrips = useMemo(() => {
    const q = search.toLowerCase();
    let list = unassignedTrips.filter((t) => {
      if (priority !== "all" && (t.priority || "normal") !== priority) return false;
      if (!q) return true;
      return (
        (t.ticketNo || "").toLowerCase().includes(q) ||
        (t.customer || "").toLowerCase().includes(q) ||
        (t.origin || "").toLowerCase().includes(q) ||
        (t.destination || "").toLowerCase().includes(q)
      );
    });
    const rank = { urgent: 0, high: 1, normal: 2 };
    list = [...list].sort((a, b) =>
      sortBy === "priority"
        ? (rank[a.priority] ?? 2) - (rank[b.priority] ?? 2)
        : new Date(a.scheduledDeparture || 0) - new Date(b.scheduledDeparture || 0)
    );
    return list;
  }, [unassignedTrips, search, priority, sortBy]);

  const upcomingDepartures = useMemo(() => {
    return [...unassignedTrips].sort(
      (a, b) => new Date(a.scheduledDeparture || 0) - new Date(b.scheduledDeparture || 0)
    );
  }, [unassignedTrips]);

  const PRIORITY_FILTERS = [
    { value: "all", label: "All" }, { value: "urgent", label: "Urgent" },
    { value: "high", label: "High" }, { value: "normal", label: "Normal" },
  ];

  return (
    <AppShell>
      <div className="ops-container">
        <div className="ops-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div className="ops-header-left">
            <h1 className="ops-title">Dispatch</h1>
            <p className="ops-subtitle">Assign drivers and vehicles to approved trips</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <span style={{ fontSize: 11, color: "var(--trackify-text-muted)" }}>
              {refreshing ? "Refreshing…" : lastUpdated ? `Updated ${relativeTime(lastUpdated)}` : ""}
              <span style={{ marginLeft: 6, color: liveStatus === "open" ? "#22C55E" : "#94A3B8" }}>
                ● {liveStatus === "open" ? "live" : "polling"}
              </span>
            </span>
            <button className="ops-btn ops-btn-secondary" onClick={refresh} disabled={refreshing} style={{ padding: "6px 12px", fontSize: 12 }}>
              <RotateCcw size={13} style={refreshing ? { animation: "spin 0.8s linear infinite" } : undefined} /> Refresh
            </button>
          </div>
        </div>

        <div className="ops-stats-bar">
          <OpsStatCard icon={FileText} label="Unassigned Trips" count={unassignedTrips.length} color="#2455D6" bg="#EEF4FF" />
          <OpsStatCard icon={User} label="Available Drivers" count={availableDrivers.length} color="#15803D" bg="#DCFCE7" />
          <OpsStatCard icon={Truck} label="Available Vehicles" count={availableVehicles.length} color="#0369A1" bg="#E0F2FE" />
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div className="ops-search" style={{ maxWidth: 300 }}>
            <Search size={14} style={{ color: "var(--trackify-text-muted)", flexShrink: 0 }} />
            <input
              type="text"
              placeholder="Search unassigned trips..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            {PRIORITY_FILTERS.map((p) => (
              <button key={p.value} className={`ops-filter-chip ${priority === p.value ? "active" : ""}`} onClick={() => setPriority(p.value)}>
                {p.label}
              </button>
            ))}
          </div>
          <button
            className={`ops-filter-chip ${sortBy === "priority" ? "active" : ""}`}
            onClick={() => setSortBy((s) => (s === "priority" ? "departure" : "priority"))}
            title="Toggle sort order"
          >
            Sort: {sortBy === "priority" ? "Priority" : "Departure"}
          </button>
        </div>

        <div className="ops-dispatch-grid">
          <div className="ops-dispatch-column">
            <div className="ops-dispatch-column-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <FileText size={14} style={{ color: "#2455D6" }} />
              <span>Unassigned Trips</span>
              <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--trackify-text-muted)", background: "#F1F5F9", padding: "2px 8px", borderRadius: 6 }}>
                {filteredTrips.length}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, overflowY: "auto", flex: 1 }}>
              {filteredTrips.length === 0 ? (
                <div className="ops-empty" style={{ padding: 24 }}>
                  <CheckCircle2 size={28} style={{ color: "#22C55E", marginBottom: 8 }} />
                  <div className="ops-empty-title">All dispatched</div>
                  <div className="ops-empty-desc">All approved trips have been assigned</div>
                </div>
              ) : (
                filteredTrips.map((trip) => (
                  <DispatchTripCard key={trip.id} trip={trip} onClick={() => setAssigningTrip(trip)} />
                ))
              )}
            </div>
          </div>

          <div className="ops-dispatch-column">
            <div className="ops-dispatch-column-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <User size={14} style={{ color: "#15803D" }} />
              <span>Available Drivers</span>
              <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--trackify-text-muted)", background: "#F1F5F9", padding: "2px 8px", borderRadius: 6 }}>
                {availableDrivers.length}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, overflowY: "auto", flex: 1 }}>
              {availableDrivers.length === 0 ? (
                <div className="ops-empty" style={{ padding: 24 }}>
                  <User size={28} style={{ color: "var(--trackify-text-muted)", marginBottom: 8, opacity: 0.4 }} />
                  <div className="ops-empty-title">No available drivers</div>
                  <div className="ops-empty-desc">All drivers are currently on trips</div>
                </div>
              ) : (
                availableDrivers.map((driver) => (
                  <ResourceCard key={driver.id} item={driver} type="driver" />
                ))
              )}
            </div>
          </div>

          <div className="ops-dispatch-column">
            <div className="ops-dispatch-column-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Truck size={14} style={{ color: "#0369A1" }} />
              <span>Available Vehicles</span>
              <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--trackify-text-muted)", background: "#F1F5F9", padding: "2px 8px", borderRadius: 6 }}>
                {availableVehicles.length}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, overflowY: "auto", flex: 1 }}>
              {availableVehicles.length === 0 ? (
                <div className="ops-empty" style={{ padding: 24 }}>
                  <Truck size={28} style={{ color: "var(--trackify-text-muted)", marginBottom: 8, opacity: 0.4 }} />
                  <div className="ops-empty-title">No available vehicles</div>
                  <div className="ops-empty-desc">All vehicles are assigned or in maintenance</div>
                </div>
              ) : (
                availableVehicles.map((vehicle) => (
                  <ResourceCard key={vehicle.id} item={vehicle} type="vehicle" />
                ))
              )}
            </div>
          </div>
        </div>

        {upcomingDepartures.length > 0 && (
          <div className="ops-card" style={{ marginTop: 16 }}>
            <div className="ops-card-header">
              <h3 className="ops-card-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Clock size={15} style={{ color: "#2455D6" }} />
                Upcoming Departures
              </h3>
              <span style={{ fontSize: 12, color: "var(--trackify-text-muted)" }}>
                Sorted by departure time
              </span>
            </div>
            <div className="ops-table-wrapper">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Trip Ticket</th>
                    <th>Customer</th>
                    <th>Route</th>
                    <th>Departure</th>
                    <th>Cargo</th>
                    <th>Weight</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {upcomingDepartures.map((trip) => (
                    <tr key={trip.id}>
                      <td className="ops-ticket-no">{trip.ticketNo}</td>
                      <td>{trip.customer}</td>
                      <td>{trip.origin} → {trip.destination}</td>
                      <td>{fmtDateTime(trip.scheduledDeparture)}</td>
                      <td>{trip.cargoDescription || "—"}</td>
                      <td>{trip.cargoWeight != null ? `${trip.cargoWeight.toLocaleString()} kg` : "—"}</td>
                      <td>
                        <button
                          className="ops-btn ops-btn-primary"
                          style={{ padding: "4px 10px", fontSize: 11 }}
                          onClick={() => setAssigningTrip(trip)}
                        >
                          <ArrowRight size={12} /> Assign
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {assigningTrip && (
        <AssignmentPanel
          trip={assigningTrip}
          drivers={availableDrivers}
          vehicles={availableVehicles}
          onClose={() => setAssigningTrip(null)}
          onAssign={handleAssign}
          saving={saving}
        />
      )}
    </AppShell>
  );
}
