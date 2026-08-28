import { useState, useMemo, useEffect } from "react";
import {
  Search, MapPin, Navigation, Clock, Signal, RefreshCw, Eye,
  ChevronRight, Truck, User, Gauge, Route, Activity, CircleDot,
  Wifi, WifiOff,
} from "lucide-react";
import TopNav from "../../components/dashboard/TopNav";
import TripStatusBadge from "../../components/operations/TripStatusBadge";
import OpsStatCard from "../../components/operations/OpsStatCard";
import { getActiveTripsWithTracking } from "../../services/operations/trackingService";
import "../../styles/operations.css";

function MapPlaceholder({ trip, tracking }) {
  if (!trip || !tracking) {
    return (
      <div className="ops-tracking-map">
        <div className="ops-map-placeholder">
          <div style={{
            width: 64, height: 64, borderRadius: 16, background: "#EEF4FF",
            display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 4,
          }}>
            <MapPin size={32} style={{ color: "#2455D6", opacity: 0.6 }} />
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--trackify-text)" }}>Select a trip to view tracking</div>
          <div style={{ fontSize: 12, color: "var(--trackify-text-muted)", maxWidth: 280, textAlign: "center", lineHeight: 1.5 }}>
            Map integration ready for Google Maps, Mapbox, or telematics provider
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ops-tracking-map">
      <div style={{ position: "absolute", top: 16, left: 16, background: "#ffffff", borderRadius: 12, padding: "10px 14px", boxShadow: "0 2px 12px rgba(7,26,74,0.1)", zIndex: 10, border: "1px solid var(--trackify-border)" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--trackify-text)" }}>
          {trip.ticketNo}
        </div>
        <div style={{ fontSize: 11, color: "var(--trackify-text-secondary)", marginTop: 2 }}>
          {tracking.currentLocation}
        </div>
      </div>

      <div className="ops-map-route">
        <div className="ops-map-route-point">
          <div className="ops-map-route-label">Origin</div>
          <div className="ops-map-route-city">{trip.origin}</div>
        </div>
        <div className="ops-map-route-line" style={{ position: "relative" }}>
          <div style={{
            position: "absolute",
            left: `${tracking.routeProgress}%`,
            top: -10,
            transform: "translateX(-50%)",
          }}>
            <Truck size={18} style={{ color: "var(--trackify-blue)" }} />
          </div>
        </div>
        <div className="ops-map-route-point">
          <div className="ops-map-route-label">Destination</div>
          <div className="ops-map-route-city">{trip.destination}</div>
        </div>
      </div>

      <div style={{ position: "absolute", bottom: 16, left: 16, right: 16, display: "flex", gap: 8 }}>
        {[
          { label: "Speed", value: `${tracking.speed} km/h`, icon: Gauge },
          { label: "ETA", value: tracking.eta, icon: Clock },
          { label: "Distance", value: `${tracking.distanceRemaining} km`, icon: Route },
        ].map((item) => (
          <div key={item.label} style={{
            background: "#ffffff", borderRadius: 10, padding: "8px 14px",
            boxShadow: "0 2px 8px rgba(7,26,74,0.08)", border: "1px solid var(--trackify-border)",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <item.icon size={13} style={{ color: "var(--trackify-blue)" }} />
            <span style={{ fontSize: 11, color: "var(--trackify-text-secondary)" }}>{item.label}:</span>
            <span style={{ fontWeight: 600, fontSize: 12, color: "var(--trackify-text)" }}>{item.value}</span>
          </div>
        ))}
      </div>

      <div style={{ position: "absolute", top: 16, right: 16, display: "flex", flexDirection: "column", gap: 6, zIndex: 10 }}>
        <button className="ops-btn ops-btn-secondary" style={{ padding: "6px 12px", fontSize: 11, boxShadow: "0 2px 8px rgba(7,26,74,0.08)" }}>
          <Navigation size={12} /> Fit Route
        </button>
        <button className="ops-btn ops-btn-secondary" style={{ padding: "6px 12px", fontSize: 11, boxShadow: "0 2px 8px rgba(7,26,74,0.08)" }}>
          <RefreshCw size={12} /> Refresh
        </button>
      </div>
    </div>
  );
}

function TrackingDetails({ trip, tracking }) {
  if (!trip) {
    return (
      <div className="ops-tracking-details">
        <div className="ops-tracking-info-card">
          <div className="ops-tracking-info-title">Trip Details</div>
          <div className="ops-empty" style={{ padding: 32 }}>
            <div style={{
              width: 48, height: 48, borderRadius: 12, background: "#EEF4FF",
              display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 8,
            }}>
              <Eye size={22} style={{ color: "#2455D6", opacity: 0.5 }} />
            </div>
            <div className="ops-empty-desc">Select a trip from the sidebar to view details</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ops-tracking-details">
      <div className="ops-tracking-info-card">
        <div className="ops-tracking-info-title" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          Trip Information
          <TripStatusBadge status={trip.status} />
        </div>
        <div className="ops-detail-grid" style={{ gridTemplateColumns: "1fr" }}>
          <div className="ops-detail-item">
            <span className="ops-detail-label">Trip Ticket</span>
            <span className="ops-detail-value" style={{ color: "var(--trackify-blue)" }}>{trip.ticketNo}</span>
          </div>
          <div className="ops-detail-item">
            <span className="ops-detail-label">Customer</span>
            <span className="ops-detail-value">{trip.customer}</span>
          </div>
        </div>
      </div>

      <div className="ops-tracking-info-card">
        <div className="ops-tracking-info-title">
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Route size={14} /> Route
          </span>
        </div>
        <div className="ops-detail-grid" style={{ gridTemplateColumns: "1fr" }}>
          <div className="ops-detail-item">
            <span className="ops-detail-label">Origin</span>
            <span className="ops-detail-value">{trip.origin}</span>
          </div>
          <div className="ops-detail-item">
            <span className="ops-detail-label">Destination</span>
            <span className="ops-detail-value">{trip.destination}</span>
          </div>
          {tracking && (
            <div className="ops-detail-item">
              <span className="ops-detail-label">Current Location</span>
              <span className="ops-detail-value" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <MapPin size={13} style={{ color: "#2455D6" }} />
                {tracking.currentLocation}
              </span>
            </div>
          )}
        </div>
        {tracking && (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 6 }}>
              <span style={{ color: "var(--trackify-text-secondary)" }}>Route Progress</span>
              <span style={{ fontWeight: 600, color: "var(--trackify-text)" }}>{tracking.routeProgress}%</span>
            </div>
            <div className="ops-progress-bar">
              <div className="ops-progress-fill" style={{ width: `${tracking.routeProgress}%` }} />
            </div>
          </div>
        )}
      </div>

      <div className="ops-tracking-info-card">
        <div className="ops-tracking-info-title">
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <User size={14} /> Resources
          </span>
        </div>
        <div className="ops-detail-grid" style={{ gridTemplateColumns: "1fr" }}>
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

      {tracking && (
        <div className="ops-tracking-info-card">
          <div className="ops-tracking-info-title">
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <CircleDot size={14} /> GPS Status
            </span>
          </div>
          <div className="ops-detail-grid" style={{ gridTemplateColumns: "1fr" }}>
            <div className="ops-detail-item">
              <span className="ops-detail-label">Status</span>
              <span className="ops-detail-value" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span
                  style={{
                    width: 8, height: 8, borderRadius: "50%",
                    background: tracking.gpsStatus === "online" ? "#22C55E" : "#EF4444",
                    boxShadow: tracking.gpsStatus === "online" ? "0 0 6px rgba(34,197,94,0.4)" : "none",
                  }}
                />
                {tracking.gpsStatus === "online" ? "Online" : "Offline"}
              </span>
            </div>
            <div className="ops-detail-item">
              <span className="ops-detail-label">Speed</span>
              <span className="ops-detail-value">{tracking.speed} km/h</span>
            </div>
            <div className="ops-detail-item">
              <span className="ops-detail-label">Distance Remaining</span>
              <span className="ops-detail-value">{tracking.distanceRemaining} km</span>
            </div>
            <div className="ops-detail-item">
              <span className="ops-detail-label">ETA</span>
              <span className="ops-detail-value">{tracking.eta}</span>
            </div>
            <div className="ops-detail-item">
              <span className="ops-detail-label">Last GPS Update</span>
              <span className="ops-detail-value">
                {tracking.lastGpsUpdate ? new Date(tracking.lastGpsUpdate).toLocaleString() : "—"}
              </span>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button className="ops-btn ops-btn-secondary" style={{ flex: 1 }}>
          <Eye size={14} /> View Trip Details
        </button>
      </div>
    </div>
  );
}

export default function LiveTrackingPage() {
  const [search, setSearch] = useState("");
  const [selectedTripId, setSelectedTripId] = useState(null);
  const [activeTrips, setActiveTrips] = useState([]);

  useEffect(() => {
    getActiveTripsWithTracking().then(setActiveTrips).catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    if (!search) return activeTrips;
    const q = search.toLowerCase();
    return activeTrips.filter(
      (t) =>
        t.ticketNo.toLowerCase().includes(q) ||
        t.customer.toLowerCase().includes(q) ||
        (t.driver && t.driver.toLowerCase().includes(q)) ||
        (t.vehicle && t.vehicle.toLowerCase().includes(q))
    );
  }, [activeTrips, search]);

  const selectedTrip = activeTrips.find((t) => t.id === selectedTripId) || null;
  const selectedTracking = selectedTrip?.tracking || null;

  return (
    <div className="ops-page">
      <TopNav />
      <div className="ops-container">
        <div className="ops-header">
          <div className="ops-header-left">
            <h1 className="ops-title">Live Tracking</h1>
            <p className="ops-subtitle">Real-time operational monitoring</p>
          </div>
        </div>

        <div className="ops-stats-bar" style={{ marginBottom: 16 }}>
          <OpsStatCard icon={Activity} label="Active Trips" count={activeTrips.length} color="#15803D" bg="#DCFCE7" />
          <OpsStatCard icon={Wifi} label="GPS Online" count={activeTrips.filter(t => t.tracking?.gpsStatus === "online").length} color="#2455D6" bg="#EEF4FF" />
          <OpsStatCard icon={WifiOff} label="GPS Offline" count={activeTrips.filter(t => t.tracking?.gpsStatus !== "online").length} color="#EF4444" bg="#FEF2F2" />
        </div>

        <div className="ops-tracking-layout">
          <div className="ops-tracking-sidebar">
            <div className="ops-card">
              <div className="ops-card-header">
                <h3 className="ops-card-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Activity size={14} style={{ color: "#2455D6" }} />
                  Active Trips
                </h3>
                <span style={{
                  fontSize: 11, color: "var(--trackify-text-muted)",
                  background: "#F1F5F9", padding: "2px 8px", borderRadius: 6,
                }}>
                  {filtered.length}
                </span>
              </div>
              <div style={{ padding: "8px 12px" }}>
                <div className="ops-search" style={{ minWidth: "auto" }}>
                  <Search size={14} style={{ color: "var(--trackify-text-muted)", flexShrink: 0 }} />
                  <input
                    type="text"
                    placeholder="Search active trips..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>
              <div style={{ padding: "0 12px 12px", display: "flex", flexDirection: "column", gap: 6, overflowY: "auto", maxHeight: 500 }}>
                {filtered.length === 0 ? (
                  <div className="ops-empty" style={{ padding: 20 }}>
                    <CircleDot size={24} style={{ color: "var(--trackify-text-muted)", marginBottom: 6, opacity: 0.4 }} />
                    <div className="ops-empty-desc">No active trips</div>
                  </div>
                ) : (
                  filtered.map((trip) => (
                    <div
                      key={trip.id}
                      className={`ops-tracking-trip-card ${selectedTripId === trip.id ? "selected" : ""}`}
                      onClick={() => setSelectedTripId(trip.id)}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div className="ops-tracking-trip-id">{trip.ticketNo}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <span
                            style={{
                              width: 7, height: 7, borderRadius: "50%",
                              background: trip.tracking?.gpsStatus === "online" ? "#22C55E" : "#EF4444",
                              boxShadow: trip.tracking?.gpsStatus === "online" ? "0 0 4px rgba(34,197,94,0.4)" : "none",
                            }}
                          />
                          <span style={{ fontSize: 10, color: "var(--trackify-text-muted)" }}>
                            {trip.tracking?.gpsStatus === "online" ? "Live" : "Off"}
                          </span>
                        </div>
                      </div>
                      <div className="ops-tracking-trip-route">
                        {trip.origin} → {trip.destination}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--trackify-text-secondary)", marginTop: 2 }}>
                        {trip.driver} · {trip.vehicle}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <MapPlaceholder trip={selectedTrip} tracking={selectedTracking} />

          <TrackingDetails trip={selectedTrip} tracking={selectedTracking} />
        </div>
      </div>
    </div>
  );
}
