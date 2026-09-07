import { useEffect, useRef, useState, useCallback } from "react";
import MapView from "../components/map/MapView";
import { driverTrip, driverPing, driverStart, driverDeliver } from "./driverApi";
import DriverExpenses from "./DriverExpenses";
import DeliverySheet from "./DeliverySheet";
import DriverStops from "./DriverStops";
import OfflineBar from "./OfflineBar";
import CapabilityNotice from "./CapabilityNotice";
import { canShareLocation, isInsecureLan } from "./capabilities";

const PING_EVERY_MS = 20000;

export default function DriverTripScreen({ tripId, onBack }) {
  const [trip, setTrip] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [myPos, setMyPos] = useState(null);
  const [lastSent, setLastSent] = useState(null);

  const watchId = useRef(null);
  const lastSentAt = useRef(0);

  const load = useCallback(() => driverTrip(tripId).then(setTrip).catch((e) => setErr(e.message)), [tripId]);
  useEffect(() => { load(); }, [load]);

  // ---- location sharing ----
  const stopSharing = useCallback(() => {
    if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    setSharing(false);
  }, []);

  useEffect(() => () => stopSharing(), [stopSharing]);

  const startSharing = () => {
    if (!canShareLocation()) {
      setErr(
        isInsecureLan()
          ? "Location sharing needs a secure (https) address. Opened over http from another device, the browser blocks it."
          : "This device can't share GPS location."
      );
      return;
    }
    setErr("");
    setSharing(true);
    watchId.current = navigator.geolocation.watchPosition(
      async (p) => {
        const { latitude, longitude, speed, heading, accuracy } = p.coords;
        // Drop wildly imprecise fixes (cell-tower / wifi triangulation can be
        // several km off) — they'd yank the trail across the map.
        if (accuracy != null && accuracy > 150) return;
        setMyPos({ lat: latitude, lng: longitude });
        const now = Date.now();
        if (now - lastSentAt.current < PING_EVERY_MS) return;
        lastSentAt.current = now;
        try {
          await driverPing(tripId, {
            lat: latitude, lng: longitude,
            speedKph: speed != null ? Math.round(speed * 3.6) : null,
            heading: heading != null && !Number.isNaN(heading) ? Math.round(heading) : null,
            accuracyMeters: accuracy != null ? Math.round(accuracy) : null,
          });
          setLastSent(new Date());
        } catch (e) {
          setErr(e.message);
          if (e.status === 409) stopSharing();
        }
      },
      (geoErr) => { setErr(geoErr.message || "Couldn't get your location. Allow location access."); stopSharing(); },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
    );
  };

  async function act(fn, confirmMsg) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(true);
    setErr("");
    try {
      await fn();
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const [podOpen, setPodOpen] = useState(false);

  const confirmDelivery = async (form) => {
    await act(() => driverDeliver(tripId, form));
    setPodOpen(false);
  };

  if (err && !trip) return <div className="dr-scroll"><button className="dr-btn ghost" onClick={onBack}>← Back</button><div className="dr-err">{err}</div></div>;
  if (!trip) return <div className="dr-scroll" style={{ color: "var(--dr-text-2)" }}>Loading…</div>;

  const stops = (trip.stops || []).filter((s) => s.lat != null);
  const markers = [];
  if (trip.originLat != null) markers.push({ id: "o", lng: Number(trip.originLng), lat: Number(trip.originLat), color: "#16a34a" });
  stops.forEach((s, i) => markers.push({ id: `s${i}`, lng: Number(s.lng), lat: Number(s.lat), color: "#d97706", popupHtml: `<b>Stop ${i + 1}</b><span>${s.label || ""}</span>` }));
  if (trip.destLat != null) markers.push({ id: "d", lng: Number(trip.destLng), lat: Number(trip.destLat), color: "#dc2626" });
  if (myPos) markers.push({ id: "me", lng: myPos.lng, lat: myPos.lat, color: "#2563eb", pulse: true });
  const fitTo = markers.map((m) => [m.lng, m.lat]);
  const geom = typeof trip.routeGeom === "string"
    ? (() => { try { return JSON.parse(trip.routeGeom); } catch { return null; } })()
    : (trip.routeGeom && Array.isArray(trip.routeGeom.coordinates) ? trip.routeGeom : null);
  const routes = geom ? [{ id: "planned", geometry: geom, color: "#2563eb", width: 4 }] : [];

  return (
    <div className="dr-scroll">
      <button className="dr-btn ghost" style={{ marginBottom: 12 }} onClick={onBack}>← My trips</button>

      <OfflineBar />
      <CapabilityNotice />

      <div className="dr-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <span style={{ fontWeight: 800, fontSize: 18 }}>{trip.ticketNo}</span>
          <span className={`dr-pill ${trip.status}`}>{trip.status.replace(/_/g, " ")}</span>
        </div>
        <div style={{ fontSize: 16 }}>{trip.origin} → {trip.destination}</div>
        <div style={{ fontSize: 13, color: "var(--dr-text-2)", marginTop: 4 }}>
          {trip.customer}{trip.vehicle ? ` · ${trip.vehicle}` : ""}
          {trip.routeKm ? ` · ${trip.routeKm} km, ~${trip.routeMin} min` : ""}
          {stops.length ? ` · ${stops.length} stop${stops.length > 1 ? "s" : ""}` : ""}
        </div>
        {trip.instructions && (
          <div style={{ marginTop: 8, fontSize: 13, background: "#0b1220", border: "1px solid var(--dr-line)", borderRadius: 8, padding: "8px 10px" }}>
            {trip.instructions}
          </div>
        )}
      </div>

      {markers.length > 0 && (
        <div style={{ height: 240, borderRadius: 14, overflow: "hidden", marginBottom: 12, border: "1px solid var(--dr-line)" }}>
          <MapView center={fitTo[0]} zoom={9} markers={markers} routes={routes} fitTo={fitTo} height="100%" />
        </div>
      )}

      <DriverStops
        tripId={tripId}
        stops={trip.stops}
        canRecord={["released", "in_transit"].includes(trip.status)}
        onRecorded={load}
      />

      {["released", "in_transit"].includes(trip.status) && canShareLocation() && (
        <div className="dr-share" style={{ marginBottom: 12 }}>
          <div>
            <div style={{ fontWeight: 700 }}>Share my location</div>
            <div style={{ fontSize: 12, color: "var(--dr-text-2)" }}>
              {sharing ? (lastSent ? `Sent ${lastSent.toLocaleTimeString()}` : "Getting GPS…") : "Off — dispatch can't see you"}
            </div>
          </div>
          <button className={`dr-toggle ${sharing ? "on" : ""}`} onClick={() => (sharing ? stopSharing() : startSharing())} aria-label="Toggle location sharing" />
        </div>
      )}

      {["released", "in_transit", "delivered"].includes(trip.status) && (
        <DriverExpenses tripId={tripId} canAdd />
      )}

      {trip.status === "released" && (
        <button className="dr-btn" disabled={busy} onClick={() => act(() => driverStart(tripId), "Start this trip now?")}>
          Start trip
        </button>
      )}
      {trip.status === "in_transit" && !podOpen && (
        <button className="dr-btn ok" disabled={busy} onClick={() => setPodOpen(true)}>
          I've delivered
        </button>
      )}
      {trip.status === "in_transit" && podOpen && (
        <DeliverySheet
          tripNo={trip.ticketNo}
          busy={busy}
          onCancel={() => setPodOpen(false)}
          onConfirm={confirmDelivery}
        />
      )}
      {trip.status === "assigned" && (
        <div className="dr-card" style={{ textAlign: "center", color: "var(--dr-text-2)" }}>
          Waiting for dispatch to release this trip.
        </div>
      )}
      {trip.status === "delivered" && (
        <div className="dr-card" style={{ textAlign: "center", color: "var(--dr-ok)" }}>
          Delivered. Thanks!
        </div>
      )}

      {err && <div className="dr-err">{err}</div>}
    </div>
  );
}
