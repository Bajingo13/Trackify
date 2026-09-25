import { useEffect, useRef, useState, useCallback, lazy, Suspense } from "react";

/* MapLibre is about a megabyte — the largest thing in the driver bundle by far,
 * and a driver on mobile data pays for it before seeing their first trip. Held
 * back until a map is actually on screen. */
const MapView = lazy(() => import("../components/map/MapView"));
import { currentDriverId, driverTrip, driverPing, driverStart, driverDeliver } from "./driverApi";
import DriverExpenses from "./DriverExpenses";
import DeliverySheet from "./DeliverySheet";
import DriverStops from "./DriverStops";
import CapabilityNotice from "./CapabilityNotice";
import { canShareLocation, isInsecureLan } from "./capabilities";
import VehiclePhoto from "./VehiclePhoto";
import { TripTrack } from "./DriverBits";
import { startTracking, stopTracking, tracksInBackground, openLocationSettings } from "./tracking";
import { tap, notifySuccess } from "./native";
import { onQueueChange, pendingCount } from "./offlineQueue";
import { escapePopupHtml } from "../components/map/popupHtml";

const PING_EVERY_MS = 20000;
const HEARTBEAT_EVERY_MS = 5 * 60 * 1000;
const HEARTBEAT_CHECK_MS = 60 * 1000;

export default function DriverTripScreen({ tripId, onBack }) {
  const [trip, setTrip] = useState(null);
  const [err, setErr] = useState("");
  // Set when the problem is one the driver can only fix in Android settings,
  // so the message can carry the way there instead of just naming it.
  const [canOpenSettings, setCanOpenSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [myPos, setMyPos] = useState(null);
  const [lastSent, setLastSent] = useState(null);
  const [pendingPings, setPendingPings] = useState(0);

  const lastSentAt = useRef(0);
  const lastFix = useRef(null);
  const sendLatestPing = useRef(null);

  const load = useCallback(() => driverTrip(tripId).then(setTrip).catch((e) => setErr(e.message)), [tripId]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let active = true;
    const refreshPending = () => pendingCount(currentDriverId())
      .then(({ pings }) => { if (active) setPendingPings(pings); })
      .catch(() => {});
    const off = onQueueChange(refreshPending);
    refreshPending();
    return () => {
      active = false;
      off();
    };
  }, []);

  // ---- location sharing ----
  const stopSharing = useCallback(() => {
    lastFix.current = null;
    sendLatestPing.current = null;
    stopTracking();
    setSharing(false);
  }, []);

  useEffect(() => () => stopSharing(), [stopSharing]);

  // Dispatch can cancel or complete a trip while this screen is open. Refresh
  // the authoritative status while sharing, then tear down the native watcher
  // as soon as that status is no longer eligible for location updates.
  useEffect(() => {
    if (!sharing) return undefined;
    const id = window.setInterval(load, 15000);
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [sharing, load]);

  useEffect(() => {
    if (!sharing) return undefined;
    const id = window.setInterval(() => {
      if (
        lastFix.current &&
        Date.now() - lastSentAt.current >= HEARTBEAT_EVERY_MS
      ) {
        void sendLatestPing.current?.(lastFix.current);
      }
    }, HEARTBEAT_CHECK_MS);
    return () => window.clearInterval(id);
  }, [sharing]);

  useEffect(() => {
    if (trip && !["released", "in_transit"].includes(trip.status) && sharing) {
      stopSharing();
    }
  }, [trip?.status, sharing, stopSharing]);

  const startSharing = async () => {
    // On the web this still needs an https origin; the native app is always a
    // secure context, so the check only bites in a browser.
    if (!tracksInBackground() && !canShareLocation()) {
      setErr(
        isInsecureLan()
          ? "Location sharing needs a secure (https) address. Opened over http from another device, the browser blocks it."
          : "This device can't share GPS location."
      );
      return;
    }
    setErr("");
    setCanOpenSettings(false);
    lastSentAt.current = 0;

    const submitFix = async (fix) => {
      const now = Date.now();
      if (now - lastSentAt.current < PING_EVERY_MS) return;
      lastSentAt.current = now;
      try {
        const result = await driverPing(tripId, fix);
        const queued = await pendingCount(currentDriverId());
        setPendingPings(queued.pings);
        if (!result?.queued) setLastSent(new Date());
      } catch (e) {
        setErr(e.message);
        // 409 means the trip is no longer one this driver can ping.
        if (e.status === 409) stopSharing();
      }
    };
    sendLatestPing.current = submitFix;

    const started = await startTracking(
      async (fix) => {
        setMyPos({ lat: fix.lat, lng: fix.lng });
        // The plugin may suppress callbacks while the vehicle is stationary.
        // Retain only the last fix that passed tracking.js's accuracy filter so
        // the low-frequency heartbeat can keep Online status honest.
        lastFix.current = fix;
        await submitFix(fix);
      },
      // Not every message is a reason to switch sharing off. A GPS timeout
      // under a flyover is ordinary, and a background plugin that would not
      // start still leaves the foreground watcher running — turning the toggle
      // off in either case loses a trail that was working.
      (message, { fatal = true, canOpenSettings: settings = false } = {}) => {
        setErr(message);
        setCanOpenSettings(settings);
        if (fatal) stopSharing();
      },
    );

    if (started) { setSharing(true); tap("light"); }
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
    // Filing a delivery is the one irreversible thing on this screen. It
    // should be felt as well as seen, because a driver doing it one-handed at
    // a loading bay may not be looking at the screen when it lands.
    notifySuccess();
  };

  if (err && !trip) return <div className="dr-scroll"><button className="dr-btn ghost" onClick={onBack}>← Back</button><div className="dr-err">{err}</div></div>;
  if (!trip) return <div className="dr-scroll" style={{ color: "var(--dr-text-2)" }}>Loading…</div>;

  const stops = (trip.stops || []).filter((s) => s.lat != null);
  const markers = [];
  if (trip.originLat != null) markers.push({ id: "o", lng: Number(trip.originLng), lat: Number(trip.originLat), color: "#16a34a" });
  stops.forEach((s, i) => markers.push({ id: `s${i}`, lng: Number(s.lng), lat: Number(s.lat), color: "#d97706", popupHtml: `<b>Stop ${i + 1}</b><span>${escapePopupHtml(s.label)}</span>` }));
  if (trip.destLat != null) markers.push({ id: "d", lng: Number(trip.destLng), lat: Number(trip.destLat), color: "#dc2626" });
  if (myPos) markers.push({ id: "me", lng: myPos.lng, lat: myPos.lat, color: "#2563eb", pulse: true });
  const fitTo = markers.map((m) => [m.lng, m.lat]);
  const geom = typeof trip.routeGeom === "string"
    ? (() => { try { return JSON.parse(trip.routeGeom); } catch { return null; } })()
    : (trip.routeGeom && Array.isArray(trip.routeGeom.coordinates) ? trip.routeGeom : null);
  const routes = geom ? [{ id: "planned", geometry: geom, color: "#2563eb", width: 4 }] : [];

  return (
    <div className="dr-scroll">
      <div className="dr-detail-head">
        <button className="dr-back" onClick={onBack} aria-label="Back to my trips">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <span className="dr-detail-title">
          <span className="dr-detail-no">{trip.ticketNo}</span>
          <span className="dr-detail-sub">
            {trip.customer}
            {trip.routeKm ? ` · ${trip.routeKm} km · ~${trip.routeMin} min` : ""}
          </span>
        </span>
        <span className={`dr-pill ${trip.status}`}>{trip.status.replace(/_/g, " ")}</span>
      </div>

      <CapabilityNotice />

      {/* The run itself: the truck, where it has got to, and the road. */}
      <div className="dr-block">
        <div className="dr-veh-panel">
          {trip.vehicle && <span className="dr-veh-badge">{trip.vehicle}</span>}
          <VehiclePhoto
            vehicleType={trip.vehicleType}
            status={trip.status}
            className="dr-veh-photo"
          />
        </div>
        <div className={`dr-veh-road${trip.status === "in_transit" ? " running" : ""}`} />

        {markers.length > 0 && (
          <div style={{ height: 220 }}>
            <Suspense
              fallback={<div className="dr-map-loading" style={{ position: "static", height: "100%" }}>Loading map…</div>}
            >
              <MapView
                markers={markers}
                routes={routes}
                fitTo={fitTo}
                fitPadding={28}
                height="100%"
              />
            </Suspense>
          </div>
        )}

        <div className="dr-block-body">
          <TripTrack status={trip.status} />
          <div className="dr-legs">
            <span className="dr-leg">
              <span className="dr-leg-label">From</span>
              <span className="dr-leg-place">{String(trip.origin || "").split(",")[0]}</span>
            </span>
            {stops.length > 0 && (
              <span className="dr-leg-gap">
                {stops.length} stop{stops.length > 1 ? "s" : ""}
              </span>
            )}
            <span className="dr-leg to">
              <span className="dr-leg-label">To</span>
              <span className="dr-leg-place">{String(trip.destination || "").split(",")[0]}</span>
            </span>
          </div>
        </div>
      </div>

      {trip.instructions && (
        <div className="dr-note" style={{ marginBottom: 12 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v5M12 16.5v.01" />
          </svg>
          <span>{trip.instructions}</span>
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
              {sharing
                ? pendingPings > 0
                  ? `${pendingPings} location ${pendingPings === 1 ? "update" : "updates"} saved on this phone`
                  : lastSent
                    ? `Sent ${lastSent.toLocaleTimeString()}${tracksInBackground() ? " · background mode active" : ""}`
                    : "Getting GPS…"
                : tracksInBackground()
                  ? "Off — dispatch can't see you"
                  : "Off — and a browser only tracks while this screen is open"}
            </div>
          </div>
          <button className={`dr-toggle ${sharing ? "on" : ""}`} onClick={() => (sharing ? stopSharing() : startSharing())} aria-label="Toggle location sharing" />
        </div>
      )}

      {["released", "in_transit", "delivered"].includes(trip.status) && (
        <DriverExpenses tripId={tripId} canAdd />
      )}

      {/* The delivery sheet takes the whole screen's attention, so it is not
          squeezed into the pinned bar. */}
      {trip.status === "in_transit" && podOpen && (
        <DeliverySheet
          tripNo={trip.ticketNo}
          busy={busy}
          onCancel={() => setPodOpen(false)}
          onConfirm={confirmDelivery}
        />
      )}

      {/* Pinned, so a driver never scrolls past the one button this screen is
          for while looking for it. */}
      {(trip.status === "released" ||
        (trip.status === "in_transit" && !podOpen) ||
        trip.status === "assigned") && (
        <div className="dr-actionbar">
          {trip.status === "released" && (
            <button className="dr-btn" disabled={busy} onClick={() => act(() => driverStart(tripId), "Start this trip now?")}>
              Start trip
            </button>
          )}
          {trip.status === "in_transit" && !podOpen && (
            <button className="dr-btn ok" disabled={busy} onClick={() => setPodOpen(true)}>
              I&rsquo;ve delivered
            </button>
          )}
          {trip.status === "assigned" && (
            <div className="dr-waiting">Waiting for dispatch to release this trip.</div>
          )}
        </div>
      )}
      {trip.status === "delivered" && (
        <div className="dr-card" style={{ textAlign: "center", color: "var(--dr-ok)" }}>
          Delivered. Thanks!
        </div>
      )}

      {err && (
        <div className="dr-err">
          {err}
          {canOpenSettings && (
            <button type="button" className="dr-err-action" onClick={openLocationSettings}>
              Open settings
            </button>
          )}
        </div>
      )}
    </div>
  );
}
