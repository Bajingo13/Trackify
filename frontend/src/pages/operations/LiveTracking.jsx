import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import AppShell from "../../components/layout/AppShell";
import { useAutoRefresh, relativeTime } from "../../hooks/useAutoRefresh";
import {
  Search, MapPin, Navigation, Clock, Signal, RefreshCw, Eye,
  ChevronRight, Truck, User, Gauge, Route, Activity, CircleDot,
  Wifi, WifiOff,
} from "lucide-react";
import TripStatusBadge from "../../components/operations/TripStatusBadge";
import OpsStatCard from "../../components/operations/OpsStatCard";
import { getActiveTripsWithTracking, getTrackingHistory, getTripRoute } from "../../services/operations/trackingService";
import { fmtDateTime } from "../../services/operations/dispatchService";
import { useRealtime } from "../../services/realtime";
import MapView from "../../components/map/MapView";
import VehicleCapacity from "../../components/fleet/VehicleCapacity";
import VehiclePhoto from "../../components/fleet/VehiclePhoto";
import TrackingDetailPanel from "../../components/operations/TrackingDetailPanel";
import { getAllDrivers } from "../../services/fleet/driverService";
import { usePermissions } from "../../auth/permissions";
import "../../styles/operations.css";
import useSmoothedPositions from "../../hooks/useSmoothedPositions";

// MapLibre popups use setHTML. Trip fields are editable, so escape every
// value before it reaches that HTML sink.
const escapePopupHtml = (value) => String(value ?? "").replace(
  /[&<>"']/g,
  (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
);

/** Schematic GPS view — plots the ping trail + current position on a scaled grid.
 *  Not a real basemap (no external map provider), but shows true coordinates. */
function GpsTrail({ trail, lat, lng }) {
  const pts = (trail || []).filter((p) => p.lat != null && p.lng != null);
  const all = [...pts.map((p) => [p.lng, p.lat]), ...(lat != null && lng != null ? [[lng, lat]] : [])];
  if (all.length === 0) return null;

  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  let minX = Math.min(...xs), maxX = Math.max(...xs);
  let minY = Math.min(...ys), maxY = Math.max(...ys);
  const padX = (maxX - minX) * 0.3 || 0.02;
  const padY = (maxY - minY) * 0.3 || 0.02;
  minX -= padX; maxX += padX; minY -= padY; maxY += padY;

  const proj = ([x, y]) => [
    ((x - minX) / (maxX - minX)) * 100,
    100 - ((y - minY) / (maxY - minY)) * 100,
  ];
  const line = pts.map((p) => proj([p.lng, p.lat]).join(",")).join(" ");
  const cur = lat != null && lng != null ? proj([lng, lat]) : null;

  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      <defs>
        <pattern id="gt-grid" width="8" height="8" patternUnits="userSpaceOnUse">
          <path d="M8 0H0V8" fill="none" stroke="rgba(36,85,214,0.10)" strokeWidth="0.5" />
        </pattern>
      </defs>
      <rect width="100" height="100" fill="url(#gt-grid)" />
      {pts.length > 1 && (
        <polyline points={line} fill="none" stroke="#2455D6" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" opacity="0.65" vectorEffect="non-scaling-stroke" />
      )}
      {cur && (
        <g>
          <circle cx={cur[0]} cy={cur[1]} r="6" fill="rgba(36,85,214,0.15)">
            <animate attributeName="r" values="4;9;4" dur="2s" repeatCount="indefinite" />
          </circle>
          <circle cx={cur[0]} cy={cur[1]} r="3" fill="#2455D6" stroke="#fff" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        </g>
      )}
    </svg>
  );
}

function TrackMap({ trips, selectedTrip, trail, snappedTrail, liveTail, onRefresh, refreshing }) {
  // Planned road path comes from the trip's cached route (computed once on the
  // server); kept out of the active-trips payload because the geometry is large.
  const [routeGeom, setRouteGeom] = useState(null);

  useEffect(() => {
    let off = false;
    setRouteGeom(null);
    if (selectedTrip?.id != null) {
      getTripRoute(selectedTrip.id).then((r) => {
        if (!off) setRouteGeom(r?.geometry || null);
      });
    }
    return () => { off = true; };
  }, [selectedTrip?.id]);

  const markers = useMemo(() => {
    const out = [];
    for (const t of trips) {
      const g = t.tracking;
      if (g?.lat == null || g?.lng == null) continue;
      const isSel = t.id === selectedTrip?.id;
      out.push({
        id: `v-${t.id}`,
        lng: g.lng, lat: g.lat,
        color: g.gpsStatus === "online" ? "#2455D6" : "#94a3b8",
        pulse: isSel,
        popupHtml: `<b>${escapePopupHtml(t.ticketNo)}</b><span>${escapePopupHtml(t.origin)} → ${escapePopupHtml(t.destination)}${t.vehicle ? " · " + escapePopupHtml(t.vehicle) : ""}</span>`,
      });
    }
    if (selectedTrip?.originCoord) {
      out.push({ id: "o", lng: selectedTrip.originCoord.lng, lat: selectedTrip.originCoord.lat, color: "#16a34a", popupHtml: `<b>Origin</b><span>${escapePopupHtml(selectedTrip.origin)}</span>` });
    }
    if (selectedTrip?.destCoord) {
      out.push({ id: "d", lng: selectedTrip.destCoord.lng, lat: selectedTrip.destCoord.lat, color: "#dc2626", popupHtml: `<b>Destination</b><span>${escapePopupHtml(selectedTrip.destination)}</span>` });
    }
    return out;
  }, [trips, selectedTrip]);

  // Ease the vehicle pins between fixes so a truck slides along the road
  // rather than teleporting every 20 seconds. Origin and destination pins
  // never move, so they are unaffected.
  const smoothedMarkers = useSmoothedPositions(markers);

  const routes = useMemo(() => {
    const out = [];
    if (routeGeom) out.push({ id: "planned", geometry: routeGeom, color: "#94a3b8", width: 3 });
    const pts = (trail || []).filter((p) => p.lat != null && p.lng != null);
    const livePts = (liveTail || []).filter((p) => p.lat != null && p.lng != null);
    if (snappedTrail?.coordinates?.length > 1) {
      // Keep the road-matched history, then extend it with fixes received since
      // the last history poll so the trail does not lag behind the live pin.
      const tail = livePts.map((p) => [p.lng, p.lat]);
      out.push({
        id: "trail",
        geometry: { ...snappedTrail, coordinates: [...snappedTrail.coordinates, ...tail] },
        color: "#2455D6",
        width: 4,
      });
    } else if (pts.length + livePts.length > 1) {
      out.push({
        id: "trail",
        geometry: { type: "LineString", coordinates: [...pts, ...livePts].map((p) => [p.lng, p.lat]) },
        color: "#2455D6", width: 4,
      });
    }
    return out;
  }, [routeGeom, trail, snappedTrail, liveTail]);

  const fitTo = useMemo(() => {
    if (selectedTrip) {
      const p = [];
      if (selectedTrip.originCoord) p.push([selectedTrip.originCoord.lng, selectedTrip.originCoord.lat]);
      if (selectedTrip.destCoord) p.push([selectedTrip.destCoord.lng, selectedTrip.destCoord.lat]);
      const g = selectedTrip.tracking;
      if (g?.lat != null) p.push([g.lng, g.lat]);
      return p.length ? p : null;
    }
    const p = trips.filter((t) => t.tracking?.lat != null).map((t) => [t.tracking.lng, t.tracking.lat]);
    return p.length ? p : null;
  }, [selectedTrip, trips]);

  const gpsCount = trips.filter((t) => t.tracking?.lat != null).length;

  return (
    <div className="ops-tracking-map" style={{ display: "block", position: "relative", padding: 0, overflow: "hidden" }}>
      <MapView center={[125.5, 7.3]} zoom={7} markers={smoothedMarkers} routes={routes} fitTo={fitTo} height="100%" />

      <div style={{ position: "absolute", top: 12, left: 12, background: "var(--surface)", borderRadius: "var(--r-sm)", padding: "8px 12px", boxShadow: "var(--shadow-2)", border: "1px solid var(--line)", zIndex: 5, maxWidth: 260 }}>
        {selectedTrip ? (
          <>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{selectedTrip.ticketNo}</div>
            <div style={{ fontSize: 11, color: "var(--trackify-text-secondary)", marginTop: 2 }}>
              {selectedTrip.tracking?.hasGps ? selectedTrip.tracking.currentLocation : "GPS not reporting"}
              {trail?.length ? ` · ${trail.length} pings` : ""}
            </div>
            {selectedTrip.routeKm != null && (
              <div style={{ fontSize: 11, color: "var(--trackify-text-secondary)", marginTop: 1 }}>
                Planned: {selectedTrip.routeKm} km · ~{Math.round(selectedTrip.routeMin)} min
              </div>
            )}
          </>
        ) : (
          <div style={{ fontSize: 12, color: "var(--trackify-text-secondary)" }}>
            {gpsCount} of {trips.length} active {trips.length === 1 ? "trip" : "trips"} reporting GPS. Pick one for its route.
          </div>
        )}
      </div>

      <button
        className="ops-btn ops-btn-secondary"
        onClick={onRefresh}
        disabled={refreshing}
        style={{ position: "absolute", top: 12, right: 52, padding: "6px 12px", fontSize: 11, boxShadow: "0 2px 8px rgba(7,26,74,0.12)", zIndex: 5 }}
      >
        <RefreshCw size={12} style={refreshing ? { animation: "spin 0.8s linear infinite" } : undefined} />
        {refreshing ? "…" : "Refresh"}
      </button>
    </div>
  );
}

function TrackingDetails({ trip, tracking, navigate }) {
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
            <span className="ops-detail-value" style={{ fontVariantNumeric: "tabular-nums" }}>{trip.ticketNo}</span>
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
        {trip.routeKm != null && (
          <div className="ops-detail-grid" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 8 }}>
            <div className="ops-detail-item">
              <span className="ops-detail-label">Planned Distance</span>
              <span className="ops-detail-value">{trip.routeKm} km</span>
            </div>
            <div className="ops-detail-item">
              <span className="ops-detail-label">Est. Drive Time</span>
              <span className="ops-detail-value">
                {trip.routeMin < 60 ? `${trip.routeMin} min` : `${Math.floor(trip.routeMin / 60)}h ${trip.routeMin % 60}m`}
              </span>
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
        {trip.vehicle && (
          <div style={{ marginTop: 10 }}>
            <VehicleCapacity
              compact
              height={72}
              title="Load on board"
              vehicle={{ plateNo: trip.vehicle, type: trip.vehicleType, capacityKg: trip.vehicleCapacityKg }}
              loadKg={trip.cargoWeightKg}
            />
          </div>
        )}
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
                    background: tracking.gpsStatus === "online" ? "var(--ok)" : "var(--danger)",
                  }}
                />
                {tracking.gpsStatus === "online" ? "Online" : "Offline"}
              </span>
            </div>
            <div className="ops-detail-item">
              <span className="ops-detail-label">Speed</span>
              <span className="ops-detail-value">{tracking.speed != null ? `${tracking.speed} km/h` : "—"}</span>
            </div>
            {tracking.heading != null && (
              <div className="ops-detail-item">
                <span className="ops-detail-label">Heading</span>
                <span className="ops-detail-value">{tracking.heading}°</span>
              </div>
            )}
            <div className="ops-detail-item">
              <span className="ops-detail-label">Planned Arrival</span>
              <span className="ops-detail-value">{fmtDateTime(tracking.plannedArrival)}</span>
            </div>
            <div className="ops-detail-item">
              <span className="ops-detail-label">Last GPS Update</span>
              <span className="ops-detail-value">{fmtDateTime(tracking.lastGpsUpdate)}</span>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button className="ops-btn ops-btn-secondary" style={{ flex: 1 }} onClick={() => navigate(`/operations/trips?trip=${trip.id}`)}>
          <Eye size={14} /> View Trip Details
        </button>
      </div>
    </div>
  );
}

const GPS_FILTERS = [
  { value: "all", label: "All" },
  { value: "online", label: "GPS online" },
  { value: "offline", label: "GPS offline" },
];

export default function LiveTrackingPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [gpsFilter, setGpsFilter] = useState("all");
  const [selectedTripId, setSelectedTripId] = useState(null);
  const [activeTrips, setActiveTrips] = useState([]);
  const [trail, setTrail] = useState([]);
  const [snappedTrail, setSnappedTrail] = useState(null);
  const [liveTail, setLiveTail] = useState([]);
  const [liveStatus, setLiveStatus] = useState("idle");
  // phone numbers live on the driver record, not on the tracking payload
  const [driversById, setDriversById] = useState({});
  const { can } = usePermissions();
  const selRef = useRef(null);
  useEffect(() => { selRef.current = selectedTripId; }, [selectedTripId]);

  const load = useCallback(async () => {
    const rows = await getActiveTripsWithTracking();
    setActiveTrips(rows);
    if (selRef.current != null) {
      setLiveTail([]);
      try {
        const h = await getTrackingHistory(selRef.current);
        setTrail(h.points);
        setSnappedTrail(h.snapped);
      } catch { /* keep */ }
    }
  }, []);

  // Poll as a fallback; the WebSocket below is the primary update path, so a
  // slower interval is plenty.
  const { refreshing, lastUpdated, refresh } = useAutoRefresh(load, 60000);

  // Realtime: apply GPS pings and status changes as they happen.
  useRealtime((msg) => {
    if (msg.type === "trip:location") {
      setActiveTrips((prev) => prev.map((t) => {
        if (t.id !== msg.tripId) return t;
        return {
          ...t,
          tracking: {
            ...t.tracking,
            hasGps: true,
            lat: msg.lat, lng: msg.lng,
            currentLocation: `${Number(msg.lat).toFixed(4)}, ${Number(msg.lng).toFixed(4)}`,
            speed: msg.speedKph ?? t.tracking.speed,
            heading: msg.heading ?? t.tracking.heading,
            gpsStatus: "online",
            lastGpsUpdate: msg.recordedAt || new Date().toISOString(),
          },
        };
      }));
      if (msg.tripId === selRef.current) {
        const point = { id: `rt-${Date.now()}`, lat: msg.lat, lng: msg.lng, recordedAt: msg.recordedAt };
        setLiveTail((prev) => [...prev, point]);
      }
    } else if (msg.type === "trip:status") {
      // a trip may have just entered or left the active set — refetch
      load();
    }
  }, setLiveStatus);

  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 15000); // keep "x ago" fresh
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    // contact details come from the driver record, which tracking.read alone
    // does not grant; without it the call/message actions simply stay disabled
    if (!can("driver.read")) return;
    let off = false;
    getAllDrivers({ limit: 500 })
      .then((res) => {
        if (off) return;
        const rows = Array.isArray(res) ? res : res?.data || res?.rows || [];
        const map = {};
        for (const d of rows) map[d.id] = d;
        setDriversById(map);
      })
      .catch(() => {});
    return () => { off = true; };
  }, [can]);

  useEffect(() => {
    setLiveTail([]);
    if (selectedTripId == null) { setTrail([]); setSnappedTrail(null); return; }
    let cancelled = false;
    getTrackingHistory(selectedTripId)
      .then((h) => { if (!cancelled) { setTrail(h.points); setSnappedTrail(h.snapped); } })
      .catch(() => { setTrail([]); setSnappedTrail(null); });
    return () => { cancelled = true; };
  }, [selectedTripId]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return activeTrips.filter((t) => {
      if (gpsFilter === "online" && t.tracking?.gpsStatus !== "online") return false;
      if (gpsFilter === "offline" && t.tracking?.gpsStatus === "online") return false;
      if (!q) return true;
      return (
        (t.ticketNo || "").toLowerCase().includes(q) ||
        (t.customer || "").toLowerCase().includes(q) ||
        (t.driver && t.driver.toLowerCase().includes(q)) ||
        (t.vehicle && t.vehicle.toLowerCase().includes(q))
      );
    });
  }, [activeTrips, search, gpsFilter]);

  const selectedTrip = activeTrips.find((t) => t.id === selectedTripId) || null;
  const selectedTracking = selectedTrip?.tracking || null;

  return (
    <AppShell>
      <div className="ops-container ops-tracking-page">
        <div className="ops-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div className="ops-header-left">
            <h1 className="ops-title">Live Tracking</h1>
            <p className="ops-subtitle">Real-time operational monitoring</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <span style={{ fontSize: 11, color: "var(--trackify-text-muted)" }}>
              {refreshing ? "Refreshing…" : lastUpdated ? `Updated ${relativeTime(lastUpdated)}` : ""}
              <span style={{ marginLeft: 6, color: liveStatus === "open" ? "var(--ok)" : "var(--text-3)" }}>
                ● {liveStatus === "open" ? "live" : "polling"}
              </span>
            </span>
            <button className="ops-btn ops-btn-secondary" onClick={refresh} disabled={refreshing} style={{ padding: "6px 12px", fontSize: 12 }}>
              <RefreshCw size={13} style={refreshing ? { animation: "spin 0.8s linear infinite" } : undefined} /> Refresh
            </button>
          </div>
        </div>

        <div className="ops-stats-bar" style={{ marginBottom: 16 }}>
          <OpsStatCard icon={Activity} label="Active Trips" count={activeTrips.length}
            active={gpsFilter === "all"} onClick={() => setGpsFilter("all")} />
          <OpsStatCard icon={Wifi} label="GPS Online" count={activeTrips.filter(t => t.tracking?.gpsStatus === "online").length}
            active={gpsFilter === "online"} onClick={() => setGpsFilter((v) => (v === "online" ? "all" : "online"))} />
          <OpsStatCard icon={WifiOff} label="GPS Offline" count={activeTrips.filter(t => t.tracking?.gpsStatus !== "online").length}
            active={gpsFilter === "offline"} onClick={() => setGpsFilter((v) => (v === "offline" ? "all" : "offline"))} />
        </div>

        <div className="ops-tracking-layout">
          <div className="ops-tracking-sidebar">
            <div className="ops-card">
              <div className="ops-card-header">
                <h3 className="ops-card-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Activity size={14} style={{ color: "var(--text-3)" }} />
                  Active Trips
                </h3>
                <span style={{
                  fontSize: 11, color: "var(--trackify-text-muted)",
                  background: "var(--surface-sunk)", padding: "2px 8px", borderRadius: "var(--r-xs)",
                }}>
                  {filtered.length}
                </span>
              </div>
              <div style={{ padding: "8px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
                <div className="ops-search" style={{ minWidth: "auto" }}>
                  <Search size={14} style={{ color: "var(--trackify-text-muted)", flexShrink: 0 }} />
                  <input
                    type="text"
                    placeholder="Search active trips..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  {GPS_FILTERS.map((g) => (
                    <button
                      key={g.value}
                      className={`ops-filter-chip ${gpsFilter === g.value ? "active" : ""}`}
                      onClick={() => setGpsFilter(g.value)}
                    >
                      {g.label}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ padding: "0 12px 12px", display: "flex", flexDirection: "column", gap: 6, overflowY: "auto", flex: "1 1 auto", minHeight: 0 }}>
                {filtered.length === 0 ? (
                  <div className="ops-empty" style={{ padding: 20 }}>
                    <CircleDot size={24} style={{ color: "var(--trackify-text-muted)", marginBottom: 6, opacity: 0.4 }} />
                    <div className="ops-empty-desc">No active trips</div>
                  </div>
                ) : (
                  filtered.map((trip) => (
                    <button
                      key={trip.id}
                      type="button"
                      data-gps={trip.tracking?.gpsStatus === "online" ? "online" : "offline"}
                      className={`ops-track-card ${selectedTripId === trip.id ? "selected" : ""}`}
                      aria-pressed={selectedTripId === trip.id}
                      onClick={() => setSelectedTripId(trip.id)}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                        <span className="ops-track-ticket">{trip.ticketNo}</span>
                        <span className="ops-track-state" style={{ flexShrink: 0 }}>
                          {trip.tracking?.gpsStatus === "online" ? "Live" : "No signal"}
                        </span>
                      </div>
                      <div className="ops-track-route" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {trip.origin} → {trip.destination}
                      </div>
                      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 8, marginTop: 4 }}>
                        <div style={{ minWidth: 0 }}>
                          <div className="ops-track-meta" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {[trip.driver, trip.vehicle].filter(Boolean).join(" · ") || "No resources assigned"}
                          </div>
                          {trip.tracking?.lastGpsUpdate && (
                            <div className="ops-track-meta" style={{ marginTop: 1 }}>
                              {trip.tracking.speed != null ? `${trip.tracking.speed} km/h · ` : ""}
                              {relativeTime(new Date(trip.tracking.lastGpsUpdate))}
                            </div>
                          )}
                        </div>
                        <VehiclePhoto
                          type={trip.vehicleType || "Box Truck"}
                          height={30}
                          muted={!trip.vehicle}
                          animated={trip.tracking?.gpsStatus === "online" && trip.tracking?.speed > 0}
                          load={trip.cargoWeightKg != null && trip.vehicleCapacityKg > 0 ? trip.cargoWeightKg / trip.vehicleCapacityKg : null}
                          style={{ flexShrink: 0, opacity: 0.9 }}
                        />
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>

          <TrackMap trips={activeTrips} selectedTrip={selectedTrip} trail={trail} snappedTrail={snappedTrail} liveTail={liveTail} onRefresh={refresh} refreshing={refreshing} />

          <TrackingDetailPanel
            trip={selectedTrip}
            tracking={selectedTracking}
            driverContact={selectedTrip?.driverId != null ? driversById[selectedTrip.driverId] : null}
            navigate={navigate}
          />
        </div>
      </div>
    </AppShell>
  );
}
