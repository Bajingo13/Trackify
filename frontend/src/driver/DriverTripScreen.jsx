import { useEffect, useRef, useState, useCallback, lazy, Suspense } from "react";

/* MapLibre is about a megabyte — the largest thing in the driver bundle by far,
 * and a driver on mobile data pays for it before seeing their first trip. Held
 * back until a map is actually on screen. */
const MapView = lazy(() => import("../components/map/MapView"));
import { currentDriverId, driverTrip, driverStart, driverDeliver, driverUnread, driverArriveAtStop, driverPauseActive, driverPauseResume, driverPauseWithdraw } from "./driverApi";
import { pauseReasonLabel } from "./supportKinds";
import { Badge, tripBadge } from "./DriverListBits";
import { useDriverRealtime } from "./driverRealtime";
import { readPosition } from "./readPosition";
import { hasArrived } from "./arrival";
import DriverChat from "./DriverChat";
import DriverExpenses from "./DriverExpenses";
import DeliverySheet from "./DeliverySheet";
import DriverStops from "./DriverStops";
import CapabilityNotice from "./CapabilityNotice";
import { canShareLocation } from "./capabilities";
import VehiclePhoto from "./VehiclePhoto";
import { TripTrack, RouteTimeline, fmtDuration, splitPlace } from "./DriverBits";
import { tracksInBackground, openLocationSettings } from "./tracking";
import { noteTripStatus, startSharing, stopSharing, useLocationSession } from "./locationSession";
import { tap, notifySuccess } from "./native";
import { telHref } from "./telHref";
import DriverLoader from "./DriverLoader";
import { useHeld } from "./useHeld";
import { onQueueChange, pendingCount } from "./offlineQueue";
import { escapePopupHtml } from "../components/map/popupHtml";
import { isDone, drivenLine, useDrivenTrail, fmtClock, spansDays } from "./drivenTrail";

/*
 * Trips whose arrival has already been announced on this phone, this session.
 * Held outside the component so leaving the screen and coming back while still
 * parked at the gate does not pop the delivery form up a second time.
 */
const announced = new Set();

export default function DriverTripScreen({ tripId, onBack, openChat = false, view: controlledView, onViewChange, onHelp }) {
  const [trip, setTrip] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingPings, setPendingPings] = useState(0);

  // Two views of one run: its details, and the active route. They are one screen
  // because they share the location watcher and the trip itself; the phone's
  // back button steps from the route to the details (see DriverApp).
  const [localView, setLocalView] = useState("details");
  const view = controlledView ?? localView;
  const setView = onViewChange ?? setLocalView;
  const [refitCount, setRefitCount] = useState(0); // bumped by the fit-route button: show the whole route again
  const [arriving, setArriving] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(true); // the route panel: details shown, or folded to the buttons
  // Set when the truck comes within range of the drop-off pin: the notice, and
  // what the delivery sheet says it opened for.
  const [atDropoff, setAtDropoff] = useState(null);

  const load = useCallback(() => driverTrip(tripId).then(setTrip).catch((e) => setErr(e.message)), [tripId]);
  useEffect(() => { load(); }, [load]);
  // The pause on this delivery, if one is waiting for the office or in force. The
  // phone has no live socket, so it is asked for on a slow timer, and on coming back
  // to the app — which is how "approved" reaches a driver watching this screen.
  const [pause, setPause] = useState(null);
  const [pauseBusy, setPauseBusy] = useState(false);
  const [pauseErr, setPauseErr] = useState("");
  const loadPause = useCallback(
    () => driverPauseActive(tripId).then(setPause).catch(() => { /* keep what is on screen */ }),
    [tripId],
  );
  // the office decided on this run's pause: show it now
  useDriverRealtime((msg) => { if (msg?.type === "trip:pause" && msg.tripId === Number(tripId)) loadPause(); });
  useEffect(() => {
    loadPause();
    const id = window.setInterval(() => { if (document.visibilityState === "visible") loadPause(); }, 20000);
    const onVisible = () => { if (document.visibilityState === "visible") loadPause(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [loadPause]);
  async function endPause(action) {
    setPauseErr("");
    setPauseBusy(true);
    try {
      await action(tripId);
      tap("light");
      await loadPause();
    } catch (e) {
      setPauseErr(e.message || "Could not do that.");
    } finally {
      setPauseBusy(false);
    }
  }

  // The moment a run is delivered, the active route is over: back to the details.
  // Opened again afterwards, the map stays, to look back at the road driven.
  const lastStatus = useRef(null);
  // true for the render in which the run turns delivered, before the effect below steps back
  const justDelivered = trip?.status === "delivered" && lastStatus.current != null && lastStatus.current !== "delivered";
  useEffect(() => {
    lastStatus.current = trip?.status ?? null;
    if (justDelivered && view === "route") setView("details");
  }, [trip?.status, justDelivered, view, setView]);
  const showRoute = view === "route" && !justDelivered;

  // Once the run is done, its map looks back: the road actually driven, view only.
  const done = isDone(trip?.status);
  const driven = useDrivenTrail(tripId, showRoute && done);

  // Chat with dispatch. The unread count follows the live socket (driverRealtime)
  // the moment dispatch writes, with a timer while this screen is open and a
  // check on returning to it for when the socket is down.
  const [chatOpen, setChatOpen] = useState(Boolean(openChat));
  const [unread, setUnread] = useState(0);
  const loadUnread = useCallback(() => driverUnread()
    .then((rows) => setUnread(rows.find((r) => r.tripId === Number(tripId))?.unread || 0))
    .catch(() => {}), [tripId]);
  useDriverRealtime((msg) => {
    if (!chatOpen && msg?.type === "chat:message" && msg.channel === "trip" && msg.tripId === Number(tripId)) loadUnread();
  });
  useEffect(() => {
    if (chatOpen) return undefined;
    loadUnread();
    const id = window.setInterval(loadUnread, 15000);
    const onVisible = () => { if (document.visibilityState === "visible") loadUnread(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [chatOpen, loadUnread]);

  // Location sharing, app-wide (see below).
  const session = useLocationSession();

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
  }, [session.pings]);

  // ---- location sharing ----
  // It runs for the whole app (locationSession.js), so leaving this screen, or
  // the app, never stops it: only the driver, the end of the trip, signing out
  // or a refused permission do. This screen shows it and offers the switch.
  const sessionHere = session.tripId === Number(tripId);
  const sharing = sessionHere && session.sharing;
  const myPos = sharing ? session.position : null;
  const lastSent = sharing ? session.lastSent : null;
  const shareErr = sessionHere ? session.error : "";
  // Set when the problem is one the driver can only fix in Android settings,
  // so the message can carry the way there instead of just naming it.
  const canOpenSettings = sessionHere && session.canOpenSettings;

  // Dispatch can cancel or complete a trip while this screen is open. Refresh
  // the authoritative status while sharing; a status that is over ends sharing
  // for this trip at once (the session also checks by itself, more slowly).
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
    if (trip) noteTripStatus(trip.id, trip.status);
  }, [trip?.id, trip?.status]);

  const toggleSharing = () => {
    if (sharing) { stopSharing(); return; }
    void startSharing(tripId, { prompt: true }).then((ok) => { if (ok) tap("light"); });
  };

  // The ring over the screen while a status change is going through — starting
  // the trip, reaching a stop, filing the delivery. Moving between screens and
  // tabs is not one of those and never shows it. The label is for screen
  // readers; the ring itself carries no text.
  const [working, setWorking] = useState(null);
  const workingLabel = useRef("Updating your trip");
  if (working) workingLabel.current = working;
  const showLoader = useHeld(Boolean(working));

  async function act(fn, confirmMsg, label = "Updating your trip") {
    if (confirmMsg && !window.confirm(confirmMsg)) return false;
    setBusy(true);
    setWorking(label);
    setErr("");
    try {
      await fn();
      await load();
      return true;
    } catch (e) {
      setErr(e.message);
      return false;
    } finally {
      setBusy(false);
      setWorking(null);
    }
  }

  const [podOpen, setPodOpen] = useState(false);
  // The claim form for this run. It is opened from the "+ Expense" button beside
  // "Open route" and filled in by the Expenses card, so the screen holds it.
  const [filingExpense, setFilingExpense] = useState(false);

  const confirmDelivery = async (form) => {
    await act(() => driverDeliver(tripId, form), undefined, "Completing your delivery");
    setPodOpen(false);
    // Filing a delivery is the one irreversible thing on this screen. It
    // should be felt as well as seen, because a driver doing it one-handed at
    // a loading bay may not be looking at the screen when it lands.
    notifySuccess();
  };

  /*
   * Arrival at the drop-off. Every fix the location watcher produces is checked
   * against the destination pin; the first one inside the radius announces the
   * arrival and opens proof of delivery at once, so the driver is asked for the
   * photo while standing at the door. It happens once per trip: cancelling the
   * sheet is a choice, and the notice's button brings it back.
   */
  useEffect(() => {
    if (!trip || trip.status !== "in_transit") {
      if (atDropoff) setAtDropoff(null);
      return;
    }
    if (podOpen || announced.has(trip.id) || !hasArrived(myPos, trip)) return;
    announced.add(trip.id);
    setAtDropoff({ place: splitPlace(trip.destination).title });
    setPodOpen(true);
    tap("heavy");
    notifySuccess();
  }, [myPos, trip, podOpen, atDropoff]);

  /** Reaching the next stop, stamped with where the truck is as the button is pressed. */
  async function arriveAtStop(stop) {
    setErr("");
    setArriving(true);
    setWorking("Recording your arrival");
    try {
      const pos = await readPosition();
      await driverArriveAtStop(tripId, stop.id, pos || {});
      await load();
    } catch (e) {
      setErr(e.message || "Could not record that stop.");
    } finally {
      setArriving(false);
      setWorking(null);
    }
  }

  if (err && !trip) return <div className="dr-scroll"><button className="dr-btn ghost" onClick={onBack}>← Back</button><div className="dr-err">{err}</div></div>;
  if (!trip) return <div className="dr-scroll"><DriverLoader variant="screen" label="Opening your trip…" /></div>;

  const stops = (trip.stops || []).filter((s) => s.lat != null);
  const markers = [];
  if (trip.originLat != null) markers.push({ id: "o", lng: Number(trip.originLng), lat: Number(trip.originLat), color: "#16a34a" });
  stops.forEach((s, i) => markers.push({ id: `s${i}`, lng: Number(s.lng), lat: Number(s.lat), color: "#d97706", popupHtml: `<b>Stop ${i + 1}</b><span>${escapePopupHtml(s.label)}</span>` }));
  if (trip.destLat != null) markers.push({ id: "d", lng: Number(trip.destLng), lat: Number(trip.destLat), color: "#dc2626" });
  if (myPos) markers.push({ id: "me", lng: myPos.lng, lat: myPos.lat, color: "#2563eb", pulse: true });
  const drivenGeom = done && driven.state === "ready" ? drivenLine(driven.trail) : null;
  const fitTo = [...markers.map((m) => [m.lng, m.lat]), ...(drivenGeom?.coordinates || [])];
  // Room the map keeps clear when it fits the route, so no pin lands under
  // anything drawn over it: the "next stop" bar on top; at the foot, the 18px
  // the sheet overlaps plus the credit; on the right, the column of + / − and
  // the fit-route button (12px edge + 42px + a margin). See .dr-routemap.
  const fitPadding = { top: trip.status === "in_transit" ? 76 : 32, right: 66, bottom: 92, left: 32 };
  const geom = typeof trip.routeGeom === "string"
    ? (() => { try { return JSON.parse(trip.routeGeom); } catch { return null; } })()
    : (trip.routeGeom && Array.isArray(trip.routeGeom.coordinates) ? trip.routeGeom : null);
  // With a trail to show, the plan steps back to a thin grey line under the road driven.
  const routes = [];
  if (geom) routes.push(drivenGeom
    ? { id: "planned", geometry: geom, color: "#94a3b8", width: 3 }
    : { id: "planned", geometry: geom, color: "#2563eb", width: 4 });
  if (drivenGeom) routes.push({ id: "driven", geometry: drivenGeom, color: "#2563eb", width: 5 });

  const live = trip.status === "in_transit";
  // "Paused" / "Pause requested" in place of "in transit" while a pause holds the run
  // the same badge as Today's list and History: one status vocabulary
  const pill = tripBadge(trip.status, pause?.status);
  const dest = splitPlace(trip.destination).title;
  const nextStop = (trip.stops || []).find((s) => !s.arrivedAt);
  const reached = (trip.stops || []).filter((s) => s.arrivedAt).length;
  const duration = fmtDuration(trip.routeMin);
  const arrivalAt = trip.scheduledArrival ? new Date(trip.scheduledArrival) : null;
  const arrival = arrivalAt && !Number.isNaN(arrivalAt.getTime())
    ? {
      time: arrivalAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
      date: arrivalAt.toLocaleDateString([], { month: "short", day: "numeric" }),
    }
    : null;

  const facts = [
    trip.customer ? { label: "Customer", value: trip.customer } : null,
    trip.cargo ? { label: "Cargo", value: trip.cargo } : null,
    trip.vehicle ? { label: "Vehicle", value: trip.vehicle, sub: trip.vehicleType || null } : null,
    (trip.stops || []).length > 0
      ? { label: "Stops", value: `${trip.stops.length} on this run`, sub: `${reached} reached` }
      : null,
  ].filter(Boolean);

  const hasMap = markers.length > 0;
  // A driver can file an expense once the truck has been released.
  const canFileExpense = ["released", "in_transit", "delivered"].includes(trip.status);
  const eligible = ["released", "in_transit"].includes(trip.status);
  const plan = [trip.routeKm ? `${trip.routeKm} km` : null, duration].filter(Boolean).join(" · ");

  // Planned figures from the ticket; nothing here is estimated on the phone.
  const summary = [
    arrival ? { label: "Arrive by", value: arrival.time, sub: arrival.date } : null,
    trip.routeKm ? { label: "Distance", value: `${trip.routeKm} km` } : null,
    duration ? { label: "Est. time", value: duration } : null,
  ].filter(Boolean);

  const startTrip = async () => {
    const ok = await act(() => driverStart(tripId), "Start this trip now?", "Starting your trip");
    // Dispatch should see the truck from the first minute, and a toggle is
    // easy to forget. The driver can still turn it off.
    if (ok && !sharing && canShareLocation()) {
      void startSharing(tripId, { prompt: true });
    }
    // Starting is the moment the driver wants the road, not the paperwork.
    if (ok && hasMap) setView("route");
  };

  const chatButton = (
    <button
      type="button"
      className="dr-chat-open"
      onClick={() => { tap("light"); setChatOpen(true); setUnread(0); }}
      aria-label={unread > 0 ? `Chat with dispatch, ${unread} new` : "Chat with dispatch"}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
      {unread > 0 && <span className="dr-chat-badge">{unread}</span>}
    </button>
  );

  // Calls the customer for this run — to say the truck is outside, or to ask the
  // way to a gate. It is only offered when the customer record has a number that
  // can be dialled; a dead button on a roadside would be worse than none.
  const callHref = telHref(trip.customerPhone);
  const callName = trip.customerContact || trip.customer || "the customer";
  const callButton = callHref && (
    <a
      className="dr-chat-open dr-call-open"
      href={callHref}
      onClick={() => tap("light")}
      aria-label={`Call ${callName}`}
      title={`Call ${callName}`}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
      </svg>
    </a>
  );

  // Only while a request waits for the office: it carries the way to withdraw it. Once the
  // pause is approved the Paused button on the route says so, and no banner is needed.
  const pauseBanner = pause?.status === "pending" && (
    <div className="dr-pause-banner dr-pause-banner-static dr-pause-compact" data-status={pause.status} role="status">
      <svg className="dr-pause-compact-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" /><path d="M10 9v6M14 9v6" />
      </svg>
      <span className="dr-pause-compact-text">
        <span className="dr-pause-banner-title">Pause requested</span>
        <span className="dr-pause-banner-sub">
          {pauseReasonLabel(pause.reason)} · waiting for the office
        </span>
        {pauseErr && <span className="dr-err tight" role="alert">{pauseErr}</span>}
      </span>
      <span className="dr-pause-compact-actions">
        {pause.status === "pending" && (
          <button type="button" className="dr-pause-mini" disabled={pauseBusy} onClick={() => endPause(driverPauseWithdraw)}>
            {pauseBusy ? "…" : "Withdraw"}
          </button>
        )}
        {onHelp && pause.ticketId && (
          <button type="button" className="dr-pause-mini" aria-label="View request" onClick={() => onHelp({ ticketId: pause.ticketId })}>View</button>
        )}
      </span>
    </div>
  );

  // While a pause is in force the delivery button gives way to this: a delivery that
  // the office has put on hold is not one to be marked delivered, and the one thing a
  // driver does next is go back on the road.
  const pausedButton = pause?.status === "approved" && (
    <button type="button" className="dr-btn paused" disabled={pauseBusy} onClick={() => endPause(driverPauseResume)}>
      <span>{pauseBusy ? "Resuming…" : "Paused"}</span>
      {!pauseBusy && <small>Tap to resume delivery</small>}
    </button>
  );

  const backIcon = (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m15 18-6-6 6-6" />
    </svg>
  );

  const shareRow = (className) => eligible && canShareLocation() && (
    <div className={`dr-share ${className}`}>
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
              : "Off — and a browser only tracks while this page is open"}
        </div>
      </div>
      <button className={`dr-toggle ${sharing ? "on" : ""}`} onClick={toggleSharing} aria-label="Toggle location sharing" aria-pressed={sharing} />
    </div>
  );

  const errBlock = (err || shareErr) && (
    <div className="dr-err">
      {err || shareErr}
      {!err && canOpenSettings && (
        <button type="button" className="dr-err-action" onClick={openLocationSettings}>
          Open settings
        </button>
      )}
    </div>
  );

  const overlays = (
    <>
      {showLoader && <DriverLoader label={workingLabel.current} />}
      {chatOpen && (
        <DriverChat tripId={tripId} ticketNo={trip.ticketNo} onClose={() => setChatOpen(false)} />
      )}
      {/* The delivery sheet takes the whole screen's attention, so it is not
          squeezed into a pinned bar. */}
      {atDropoff && trip.status === "in_transit" && (
        <div className="dr-arrive" role="alert">
          <span className="dr-arrive-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 13 4 4L19 7" /></svg>
          </span>
          <span className="dr-arrive-text">
            <strong>You&rsquo;ve arrived</strong>
            <span>{atDropoff.place} · take a photo and confirm the delivery.</span>
          </span>
          {!podOpen ? (
            <button type="button" className="dr-arrive-btn" onClick={() => setPodOpen(true)}>Confirm delivery</button>
          ) : null}
        </div>
      )}
      {trip.status === "in_transit" && podOpen && (
        <DeliverySheet
          tripNo={trip.ticketNo}
          place={atDropoff?.place}
          arrived={Boolean(atDropoff)}
          busy={busy}
          onCancel={() => setPodOpen(false)}
          onConfirm={confirmDelivery}
        />
      )}
    </>
  );

  /* ------------------------------------------------------------------ */
  /* The active route: the road first, then what is next                */
  /* ------------------------------------------------------------------ */
  if (showRoute && hasMap) {
    const stopTotal = (trip.stops || []).length;
    const there = live
      ? nextStop
        ? { kind: "Next stop", place: nextStop.label, badge: `Stop ${reached + 1} of ${stopTotal}` }
        : { kind: "Destination", place: trip.destination, badge: atDropoff ? "You\u2019re here" : "Final stop" }
      : trip.status === "released"
        ? { kind: "Pickup", place: trip.origin, badge: "Not started" }
        : null;
    const where = there ? splitPlace(there.place) : null;

    return (
      <div className="dr-routeview">
        <div className="dr-routehead">
          <button className="dr-back" onClick={() => setView("details")} aria-label="Back to load details">{backIcon}</button>
          <span className="dr-detail-title">
            <span className="dr-detail-no">{live ? "Active route" : done ? "Route driven" : "Route"}</span>
            <span className="dr-detail-sub">{trip.ticketNo}</span>
          </span>
          <Badge tone={pill.tone}>{pill.label}</Badge>
          <span className="dr-head-actions">
            {callButton}
            {chatButton}
          </span>
        </div>
        {pauseBanner}

        <div className="dr-routemap">
          {live && (
            <div className="dr-nextbar">
              <span className="dr-nextbar-icon" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 21s-6-5.2-6-10a6 6 0 0 1 12 0c0 4.8-6 10-6 10z" />
                  <circle cx="12" cy="11" r="2.2" />
                </svg>
              </span>
              <span className="dr-nextbar-text">
                <span className="dr-nextbar-label">{nextStop ? "Next stop" : "Heading to"}</span>
                <span className="dr-nextbar-place">{nextStop ? splitPlace(nextStop.label).title : dest}</span>
              </span>
            </div>
          )}
          <div className="dr-routemap-fill">
            <Suspense
              fallback={<div className="dr-map-loading" style={{ position: "static", height: "100%" }}><DriverLoader variant="inline" label="Loading map…" /></div>}
            >
              <MapView
                markers={markers}
                routes={routes}
                fitTo={fitTo}
                fitPadding={fitPadding}
                height="100%"
                // a driver who zooms or pans keeps that view; the button below brings the route back
                keepUserView
                refitSignal={refitCount}
                // the + / − sit with the fit-route button, clear of the next-stop bar on top
                controlsPosition="bottom-right"
                attributionPosition="bottom-left"
              />
            </Suspense>
          </div>
          <button type="button" className="dr-mapfab" aria-label="Fit the whole route on screen" onClick={() => { tap("light"); setRefitCount((n) => n + 1); }}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="8" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
            </svg>
          </button>
        </div>

        <div className="dr-sheet">
          <span className="dr-sheet-grab" aria-hidden="true" />

          {/* The header is the handle: tap it to fold everything but the delivery
              buttons out of the way and give the map the room back. */}
          {there && (
            <button
              type="button"
              className="dr-stopcard dr-stopcard-toggle"
              aria-expanded={sheetOpen}
              aria-controls="route-details"
              onClick={() => { tap("light"); setSheetOpen((o) => !o); }}
            >
              <span className="dr-stopcard-dot" data-kind={there.kind === "Pickup" ? "pickup" : "drop"} aria-hidden="true" />
              <span className="dr-stopcard-main">
                <span className="dr-stopcard-kind">{there.kind}</span>
                <span className="dr-stopcard-place">{where.title}</span>
              </span>
              <Badge tone="info">{there.badge}</Badge>
              <svg className="dr-stopcard-chev" data-open={sheetOpen ? "yes" : "no"} width="18" height="18"
                   viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
                   strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
          )}

          {sheetOpen && (
            <div id="route-details" className="dr-sheet-body">
              {there && where.rest && (
                <div className="dr-addr">
                  <span className="dr-arriving-label">Address</span>
                  <span className="dr-addr-text">{where.title}, {where.rest}</span>
                </div>
              )}

              {summary.length > 0 && (
                <div className="dr-arriving">
                  {arrival && (
                    <div className="dr-arriving-main">
                      <span className="dr-arriving-label">Arrive by</span>
                      <span className="dr-arriving-time">{arrival.time}</span>
                      <span className="dr-arriving-date">{arrival.date}</span>
                    </div>
                  )}
                  <div className="dr-arriving-side">
                    {trip.routeKm && (
                      <span><span className="dr-arriving-label">Distance</span><b>{trip.routeKm} km</b></span>
                    )}
                    {duration && (
                      <span><span className="dr-arriving-label">Est. time</span><b>{duration}</b></span>
                    )}
                  </div>
                </div>
              )}

              {shareRow("dr-share-compact")}
              {live && !sharing && trip.destLat != null && canShareLocation() && (
                <p className="dr-hint">Turn on location sharing and Trackify will tell you when you reach the drop-off.</p>
              )}
            </div>
          )}
          {done && (
            <div className="dr-driven" aria-live="polite">
              {(driven.state === "idle" || driven.state === "loading") && (
                <DriverLoader variant="inline" label="Loading the route you drove…" />
              )}
              {driven.state === "error" && (
                <div className="dr-driven-row">
                  <p className="dr-hint">Couldn&rsquo;t load the route you drove.</p>
                  <button type="button" className="dr-btn ghost" onClick={() => { tap("light"); driven.retry(); }}>Try again</button>
                </div>
              )}
              {driven.state === "ready" && !drivenGeom && (
                <p className="dr-hint">No GPS route was recorded for this run. Location sharing may have been off, or the record is past the time it is kept.</p>
              )}
              {drivenGeom && (
                <>
                  <div className="dr-driven-legend">
                    <span><i className="dr-driven-swatch" data-line="driven" aria-hidden="true" />Route you drove</span>
                    {geom && <span><i className="dr-driven-swatch" data-line="planned" aria-hidden="true" />Planned route</span>}
                  </div>
                  <div className="dr-driven-figs">
                    <span><span className="dr-arriving-label">Driven</span><b>{driven.trail.distanceKm} km</b></span>
                    {driven.trail.startedAt && driven.trail.endedAt && (
                      <span>
                        <span className="dr-arriving-label">On the road</span>
                        <b>
                          {fmtClock(driven.trail.startedAt, spansDays(driven.trail.startedAt, driven.trail.endedAt))}
                          {" – "}
                          {fmtClock(driven.trail.endedAt, spansDays(driven.trail.startedAt, driven.trail.endedAt))}
                        </b>
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* An error is never folded away. */}
          {errBlock}

          <div className="dr-sheet-actions">
            {trip.status === "released" && (
              <button className="dr-btn" disabled={busy} onClick={startTrip}>Start trip</button>
            )}
            {live && !podOpen && pausedButton}
            {live && !podOpen && !pausedButton && (nextStop ? (
              <div className="dr-actions-2">
                <button className="dr-btn ghost" disabled={busy} onClick={() => setPodOpen(true)}>I&rsquo;ve delivered</button>
                <button className="dr-btn" disabled={busy || arriving} onClick={() => arriveAtStop(nextStop)}>
                  {arriving ? "Saving…" : "Arrived at stop"}
                </button>
              </div>
            ) : (
              <button className="dr-btn ok" disabled={busy} onClick={() => setPodOpen(true)}>I&rsquo;ve delivered</button>
            ))}
            {trip.status === "assigned" && <div className="dr-waiting">Waiting for dispatch to release this trip.</div>}
          </div>
        </div>

        {overlays}
      </div>
    );
  }

  /* ------------------------------------------------------------------ */
  /* Load details                                                       */
  /* ------------------------------------------------------------------ */
  return (
    <div className="dr-scroll">
      <div className="dr-detail-head">
        <button className="dr-back" onClick={onBack} aria-label="Back to my trips">{backIcon}</button>
        <span className="dr-detail-title">
          <span className="dr-detail-no">{trip.ticketNo}</span>
          {/* distance and time are in Route, just below: here they only cut the name off */}
          <span className="dr-detail-sub">{trip.customer}</span>
        </span>
        <Badge tone={pill.tone}>{pill.label}</Badge>
        {chatButton}
      </div>

      {overlays}

      {pauseBanner}

      <CapabilityNotice />

      {/* The run itself: the truck and where the run has got to. */}
      <div className="dr-block dr-hero">
        <div className="dr-veh-panel">
          {trip.vehicle && <span className="dr-veh-badge">{trip.vehicle}</span>}
          <VehiclePhoto
            vehicleType={trip.vehicleType}
            status={trip.status}
            className="dr-veh-photo"
          />
        </div>
        <div className={`dr-veh-road${live ? " running" : ""}`} />
        <div className="dr-block-body">
          <TripTrack status={trip.status} />
        </div>
      </div>

      {/* The way to the map, with the plan, right under the truck: it is the next
          thing a driver wants after seeing where the run has got to, and it sits in
          the page where it can be read and pressed, not floating over it. */}
      {(hasMap || summary.length > 0) && (
        <div className="dr-block dr-routecard">
          <div className="dr-block-head">
            <span className="dr-block-title">Route</span>
          </div>
          {summary.length > 0 && (
            <div className="dr-sum flat">
              {summary.map((x) => (
                <div className="dr-sum-cell" key={x.label}>
                  <span className="dr-sum-label">{x.label}</span>
                  <span className="dr-sum-value">{x.value}</span>
                  {x.sub && <span className="dr-sum-sub">{x.sub}</span>}
                </div>
              ))}
            </div>
          )}
          {hasMap && (
            <div className="dr-routecard-action">
              {/* One row, two weights: the map is the main thing to do here, a
                  claim the thing a driver does on the way. */}
              <div className={canFileExpense ? "dr-action-pair" : undefined}>
                <button
                  type="button"
                  className={live ? "dr-btn" : "dr-btn ghost"}
                  onClick={() => { tap("light"); setView("route"); }}
                >
                  {live ? "Open route" : "View map"}
                </button>
                {canFileExpense && (
                  <button
                    type="button"
                    className="dr-btn ghost"
                    aria-label="Add an expense"
                    onClick={() => { tap("light"); setFilingExpense(true); }}
                  >
                    + Expense
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* What is being carried, for whom, and on what. Only what the ticket has. */}
      {facts.length > 0 && (
        <div className="dr-info">
          {facts.map((x) => (
            <div className="dr-info-cell" key={x.label}>
              <span className="dr-info-label">{x.label}</span>
              <span className="dr-info-value">{x.value}</span>
              {x.sub && <span className="dr-info-sub">{x.sub}</span>}
            </div>
          ))}
        </div>
      )}

      <div className="dr-block">
        <div className="dr-block-head">
          <span className="dr-block-title">Pickup and delivery</span>
        </div>
        <div className="dr-block-body dr-rt-body">
          <RouteTimeline trip={trip} withStops />
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
        canRecord={eligible}
        onRecorded={load}
      />

      {shareRow("dr-share-spaced")}

      {/* Where a driver is when something goes wrong is on the run, so the way to
          say so is here — in words, not only an icon. */}
      {onHelp && live && !pause && (
        <div className="dr-card dr-problem">
          <div className="dr-problem-text">
            <strong>Something wrong on the road?</strong>
            <span>Report a problem, or ask the office to pause this delivery.</span>
          </div>
          <button type="button" className="dr-btn ghost" onClick={() => onHelp({ pause: true, tripId })}>
            Report a problem
          </button>
        </div>
      )}

      {canFileExpense && (
        <DriverExpenses
          tripId={tripId}
          ticketNo={trip.ticketNo}
          canAdd
          filing={filingExpense}
          onFilingChange={setFilingExpense}
          compact={hasMap}
        />
      )}

      {/* Pinned, so a driver never scrolls past the one button this screen is
          for while looking for it. Opening the route is not one of them: it lives
          in the Route card above. On the road with a map, delivery is on the route
          screen, so there is nothing to pin; without a map there is no route
          screen, and delivery has to stay here. */}
      {(trip.status === "released" ||
        (trip.status === "in_transit" && !podOpen && !hasMap) ||
        trip.status === "assigned") && (
        <div className="dr-actionbar">
          {eligible && plan && <div className="dr-actionbar-meta">Planned: {plan}</div>}
          {trip.status === "released" && (
            <button className="dr-btn" disabled={busy} onClick={startTrip}>
              Start trip
            </button>
          )}
          {trip.status === "in_transit" && !podOpen && !hasMap && pausedButton}
          {trip.status === "in_transit" && !podOpen && !hasMap && !pausedButton && (
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

      {errBlock}
    </div>
  );
}
