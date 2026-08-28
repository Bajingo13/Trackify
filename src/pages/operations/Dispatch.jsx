import { useState, useMemo, useRef, useEffect } from "react";
import {
  Search, Truck, User, MapPin, Calendar, Clock, AlertTriangle,
  CheckCircle2, XCircle, ArrowRight, RotateCcw, Filter, ChevronDown, X, FileText,
} from "lucide-react";
import TopNav from "../../components/dashboard/TopNav";
import TripStatusBadge from "../../components/operations/TripStatusBadge";
import { getDispatchBoard, validateAssignment } from "../../services/operations/dispatchService";
import "../../styles/operations.css";

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
                    <div className="ops-dispatch-card-detail">License: {d.licenseNo}</div>
                    <div className="ops-dispatch-card-detail">
                      Expires: {new Date(d.licenseExpiry).toLocaleDateString()}
                      {new Date(d.licenseExpiry) < new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) && (
                        <span style={{ color: "#B45309", marginLeft: 4, fontWeight: 600 }}>Expiring soon</span>
                      )}
                    </div>
                    <div className="ops-dispatch-card-detail">Phone: {d.phone}</div>
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
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflowY: "auto" }}>
                {vehicles.map((v) => (
                  <div
                    key={v.id}
                    className={`ops-dispatch-card ${selectedVehicle?.id === v.id ? "selected" : ""}`}
                    onClick={() => setSelectedVehicle(v)}
                    style={{ padding: "10px 12px" }}
                  >
                    <div className="ops-dispatch-card-title">{v.plateNo}</div>
                    <div className="ops-dispatch-card-detail">{v.type}</div>
                    <div className="ops-dispatch-card-detail">Capacity: {v.capacity.toLocaleString()} kg</div>
                    <div className="ops-dispatch-card-detail">
                      Reg: {new Date(v.registrationExpiry).toLocaleDateString()}
                    </div>
                  </div>
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
              {validation.checks.map((check, i) => (
                <div
                  key={i}
                  className={`ops-validation-item ${check.passed ? "ops-validation-passed" : "ops-validation-failed"}`}
                >
                  {check.passed ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 12 }}>{check.label}</div>
                    <div style={{ fontSize: 11, opacity: 0.8 }}>{check.message}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{
              marginTop: 12,
              padding: "10px 14px",
              borderRadius: 8,
              background: validation.allPassed ? "#DCFCE7" : "#FEF2F2",
              color: validation.allPassed ? "#15803D" : "#B91C1C",
              fontSize: 13,
              fontWeight: 600,
              textAlign: "center",
            }}>
              {validation.allPassed ? "Ready for Assignment" : "Assignment Blocked — Fix issues above"}
            </div>
          </div>
        </div>

        <div className="ops-modal-footer">
          <button className="ops-btn ops-btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="ops-btn ops-btn-primary"
            disabled={!validation.allPassed}
            onClick={() => {
              if (validation.allPassed) {
                onAssign(trip, selectedDriver, selectedVehicle);
                onClose();
              }
            }}
          >
            {validation.allPassed ? "Confirm Assignment" : "Assignment Blocked"}
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
          <span>{new Date(trip.scheduledDeparture).toLocaleDateString()} at {new Date(trip.scheduledDeparture).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--trackify-text-secondary)" }}>
          <Truck size={12} style={{ flexShrink: 0 }} />
          <span>{trip.cargoDescription} · {trip.cargoWeight != null ? trip.cargoWeight.toLocaleString() : "—"} kg</span>
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

function ResourceCard({ item, type }) {
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
            <div className="ops-dispatch-card-detail" style={{ fontSize: 11 }}>{item.phone}</div>
          </div>
        </div>
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 2 }}>
          <div className="ops-dispatch-card-detail">License: {item.licenseNo}</div>
          <div className="ops-dispatch-card-detail">
            Expires: {new Date(item.licenseExpiry).toLocaleDateString()}
            {new Date(item.licenseExpiry) < new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) && (
              <span style={{ color: "#B45309", marginLeft: 4, fontWeight: 600 }}>•</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ops-dispatch-card">
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10, background: "#EEF4FF",
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          <Truck size={16} style={{ color: "#2455D6" }} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="ops-dispatch-card-title">{item.plateNo}</div>
          <div className="ops-dispatch-card-detail" style={{ fontSize: 11 }}>{item.type}</div>
        </div>
      </div>
      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 2 }}>
        <div className="ops-dispatch-card-detail">Capacity: {item.capacity.toLocaleString()} kg</div>
        <div className="ops-dispatch-card-detail">Reg: {new Date(item.registrationExpiry).toLocaleDateString()}</div>
      </div>
    </div>
  );
}

export default function DispatchPage() {
  const [search, setSearch] = useState("");
  const [assigningTrip, setAssigningTrip] = useState(null);
  const [boardData, setBoardData] = useState({ unassignedTrips: [], availableDrivers: [], availableVehicles: [] });

  const { unassignedTrips, availableDrivers, availableVehicles } = boardData;

  useEffect(() => {
    getDispatchBoard().then(setBoardData).catch(() => {});
  }, []);

  const filteredTrips = useMemo(() => {
    if (!search) return unassignedTrips;
    const q = search.toLowerCase();
    return unassignedTrips.filter(
      (t) =>
        t.ticketNo.toLowerCase().includes(q) ||
        t.customer.toLowerCase().includes(q) ||
        t.origin.toLowerCase().includes(q) ||
        t.destination.toLowerCase().includes(q)
    );
  }, [unassignedTrips, search]);

  const upcomingDepartures = useMemo(() => {
    return [...unassignedTrips].sort(
      (a, b) => new Date(a.scheduledDeparture) - new Date(b.scheduledDeparture)
    );
  }, [unassignedTrips]);

  return (
    <div className="ops-page">
      <TopNav />
      <div className="ops-container">
        <div className="ops-header">
          <div className="ops-header-left">
            <h1 className="ops-title">Dispatch</h1>
            <p className="ops-subtitle">Assign drivers and vehicles to approved trips</p>
          </div>
        </div>

        <div className="ops-stats-bar">
          <div className="ops-stat-pill">
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: "#2455D6" }} />
              Unassigned Trips
            </span>
            <span className="ops-stat-count">{unassignedTrips.length}</span>
          </div>
          <div className="ops-stat-pill">
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: "#15803D" }} />
              Available Drivers
            </span>
            <span className="ops-stat-count">{availableDrivers.length}</span>
          </div>
          <div className="ops-stat-pill">
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: "#0369A1" }} />
              Available Vehicles
            </span>
            <span className="ops-stat-count">{availableVehicles.length}</span>
          </div>
        </div>

        <div className="ops-search" style={{ marginBottom: 12, maxWidth: 320 }}>
          <Search size={14} style={{ color: "var(--trackify-text-muted)", flexShrink: 0 }} />
          <input
            type="text"
            placeholder="Search unassigned trips..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
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
                      <td>{new Date(trip.scheduledDeparture).toLocaleString()}</td>
                      <td>{trip.cargoDescription}</td>
                      <td>{trip.cargoWeight != null ? trip.cargoWeight.toLocaleString() : "—"} kg</td>
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
          onAssign={(trip, driver, vehicle) => {
            alert(`Assigned ${driver.name} with ${vehicle.plateNo} to ${trip.ticketNo}. (Mock action)`);
          }}
        />
      )}
    </div>
  );
}
