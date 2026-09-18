import { useEffect, useState, lazy, Suspense } from "react";
import { isNativeApp } from "../platform";

/**
 * Makes the driver app installable, without touching the staff app.
 *
 * index.html is shared by both, so the manifest and theme colour are attached
 * at runtime from here, and the service worker is registered against the
 * /driver scope only — the staff app is never served from a cache.
 */
function installDriverPwa() {
  // The native app is already installed, and its bundle is served from the
  // app container rather than over the network — a manifest and a service
  // worker scoped to /driver have nothing to do there.
  if (isNativeApp()) return;
  if (!document.querySelector('link[rel="manifest"]')) {
    const link = document.createElement("link");
    link.rel = "manifest";
    link.href = "/driver-manifest.webmanifest";
    document.head.appendChild(link);
  }
  if (!document.querySelector('meta[name="theme-color"]')) {
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.content = "#f1f5fb";
    document.head.appendChild(meta);
  }
  // a service worker is refused outright on an insecure origin, so over plain
  // http from another device the app simply is not installable
  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker
      .register("/driver-sw.js", { scope: "/driver" })
      .catch(() => { /* unsupported or blocked — the app still works online */ });
  }
}


import { getDriverAuth, setDriverAuth, clearDriverAuth, driverLogin, driverTrips } from "./driverApi";
import DriverTripScreen from "./DriverTripScreen";
import CapabilityNotice from "./CapabilityNotice";
import TrackingScene from "../components/login/TrackingScene";
import heroTruck from "../assets/hero-truck.jpg";
import { TripTrack, TripVehicle, IconMark, greeting } from "./DriverBits";
import VehiclePhoto from "./VehiclePhoto";
import DriverTabBar from "./DriverTabBar";
import DriverAgreementGate from "./DriverAgreementGate";
import DriverProfile from "./DriverProfile";
import DriverHistory from "./DriverHistory";
import DriverClaims from "./DriverClaims";
import { onHardwareBack, settleChrome, tap } from "./native";

/* MapLibre is ~1 MB; only a driver with a real run ever loads it. */
const MapView = lazy(() => import("../components/map/MapView"));
import "./driver.css";

export default function DriverApp() {
  useEffect(installDriverPwa, []);
  useEffect(settleChrome, []);

  const [auth, setAuth] = useState(getDriverAuth());
  const [tripId, setTripId] = useState(null);
  const [tab, setTab] = useState("trips");
  // "pushing" when a trip was opened, "popping" on the way back, so the
  // screens travel in the direction the driver moved.
  const [nav, setNav] = useState(null);

  const openTrip = (id) => { setNav("pushing"); setTripId(id); tap("light"); };
  const closeTrip = () => { setNav("popping"); setTripId(null); };

  // Moving between tabs is lateral, not up or down a hierarchy, so it clears
  // the push/pop direction first. Without this a tab switch inherits whatever
  // the last trip did and slides in from the side like a screen being popped.
  const changeTab = (next) => { setNav(null); setTab(next); };

  // Android's back button closes the app from any screen unless something
  // claims the press. There are three levels here: out of a trip, back to
  // Today, then out. Dropping a driver onto the home screen from the Claims
  // tab because back meant "exit" is the kind of thing that makes an app feel
  // like a web page in a frame.
  useEffect(() => onHardwareBack(() => {
    if (tripId != null) { closeTrip(); return true; }
    if (tab !== "trips") { changeTab("trips"); return true; }
    return false;
  }), [tripId, tab]);

  const signOut = () => {
    clearDriverAuth();
    setAuth(null);
    setTripId(null);
    setTab("trips");
  };

  if (!auth) {
    return (
      <div className="dr">
        <Login
          onSuccess={(a) => { setDriverAuth(a); setAuth(a); }}
        />
      </div>
    );
  }

  // A trip is a task, not a destination: it takes the whole screen, and the
  // tabs step out of the way until the driver comes back from it. Leaving the
  // bar up would invite a mis-tap into Claims halfway through a delivery.
  const inTrip = tripId != null;

  // Nothing below opens until the Agreement is accepted — including the trip
  // list, because section 4.1.1 collects this driver's location and 4.3 gives
  // consent as the basis for it. Declining signs out, which is what the
  // Agreement itself says a person who does not agree must do.
  return (
    <DriverAgreementGate onDecline={signOut}>
    <div className="dr" data-tab={tab}>
      {!inTrip && <ScreenHead tab={tab} name={auth.driver?.name} />}

      {/* keyed so React remounts on navigation and the animation actually runs */}
      <div className={`dr-screen ${nav || ""}`} key={inTrip ? tripId : tab}>
        {inTrip ? (
          <DriverTripScreen tripId={tripId} onBack={closeTrip} />
        ) : tab === "trips" ? (
          <TripList onOpen={openTrip} />
        ) : tab === "history" ? (
          <DriverHistory />
        ) : tab === "claims" ? (
          <DriverClaims />
        ) : (
          <DriverProfile onSignOut={signOut} />
        )}
      </div>

      {!inTrip && <DriverTabBar active={tab} onChange={changeTab} />}
    </div>
    </DriverAgreementGate>
  );
}

/**
 * The title strip above each tab.
 *
 * Today keeps the greeting, because the first thing a driver wants at 5am is
 * to be addressed rather than labelled. The other three take a plain title —
 * a greeting repeated on every tab stops meaning anything.
 */
function ScreenHead({ tab, name }) {
  if (tab === "trips") {
    return (
      <div className="dr-home-head">
        <div>
          <div className="dr-greet">{greeting()}</div>
          <div className="dr-greet-name">{name || "Driver"}</div>
        </div>
      </div>
    );
  }

  const TITLES = {
    history: ["Your runs", "Everything you have finished"],
    claims: ["Your claims", "What you have filed, and where it stands"],
    profile: ["Your account", "Licence, contact and photo"],
  };
  const [title, sub] = TITLES[tab] || ["", ""];

  return (
    <div className="dr-home-head">
      <div>
        <div className="dr-head-title">{title}</div>
        <div className="dr-head-sub">{sub}</div>
      </div>
    </div>
  );
}

/**
 * What a driver reads when sign-in fails.
 *
 * "Failed to fetch" is what the browser says when a request never reached the
 * server at all — no signal, no route to the API. It is accurate and it is
 * useless at the roadside, so it is translated. Anything the server itself
 * said (a wrong PIN, a locked account) is already written for a person and is
 * passed through untouched. The original still reaches the console for us.
 */
function humanError(err) {
  const raw = String(err?.message || "")
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(raw)) {
    console.warn("[driver] sign-in network failure:", raw)
    return "Can't reach Trackify. Check your signal and try again."
  }
  return raw || "Sign-in failed. Try again."
}

function Login({ onSuccess }) {
  const [employeeNo, setEmployeeNo] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const res = await driverLogin(employeeNo.trim(), pin.trim());
      onSuccess(res.data);
    } catch (e2) {
      setErr(humanError(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dr-scroll" style={{ padding: 0 }}>
      <div className="dr-login shot">
        <img className="dr-hero-art" src={heroTruck} alt="" aria-hidden="true" />
        <span className="dr-hero-veil" />

        <div className="dr-hero-mark">
          <span className="dr-hero-mark-badge"><IconMark /></span>
          <span className="dr-hero-mark-text">Trackify</span>
        </div>

        <div className="dr-shot-copy">
          <h1 className="dr-headline">
            Every run.<br />Start to signature.
          </h1>
          <p className="dr-sub">
            Your trips, your stops and your receipts — on the road, or out of signal.
          </p>
        </div>

        <div className="dr-shot-sheet">
          <span className="dr-grab" />
          <CapabilityNotice />
          <form onSubmit={submit}>
            <div style={{ marginBottom: 14 }}>
              <label className="dr-label">Employee number</label>
              <input
                className="dr-input"
                style={{ letterSpacing: "normal", textAlign: "left", fontSize: 16 }}
                value={employeeNo}
                onChange={(e) => setEmployeeNo(e.target.value)}
                placeholder="DRV-001"
                autoCapitalize="characters"
                autoCorrect="off"
              />
            </div>
            <div style={{ marginBottom: 18 }}>
              <label className="dr-label">PIN</label>
              <input
                className="dr-input"
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                placeholder="••••"
              />
            </div>
            <button className="dr-btn ink" disabled={busy || !employeeNo || pin.length < 4}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
            {err && <div className="dr-err">{err}</div>}
          </form>
        </div>
      </div>
    </div>
  );
}

/** Place names arrive fully qualified ("Balayan, Batangas, Calabarzon, 4213,
 *  Philippines"). In a list row only the first part is worth the width. */
function shortPlace(place) {
  return String(place || "").split(",")[0].trim();
}

/**
 * The run drawn on the map, from the coordinates the trip already carries.
 *
 * MapLibre is about a megabyte, so it is held back behind Suspense and only
 * fetched once a trip with real coordinates is on screen — a driver with no
 * assigned run never pays for it. Nothing is invented: a trip saved without
 * endpoints simply has no map rather than a guessed one.
 */
function TripMap({ trip }) {
  const markers = [];
  if (trip.originLat != null) {
    markers.push({ id: "o", lng: Number(trip.originLng), lat: Number(trip.originLat), color: "#158a4a" });
  }
  if (trip.destLat != null) {
    markers.push({ id: "d", lng: Number(trip.destLng), lat: Number(trip.destLat), color: "#c23b3b" });
  }
  if (markers.length < 2) return null;

  // The cached road geometry if the trip has one; a straight line between the
  // endpoints would be a road that does not exist, so there is simply no line
  // when the route was never computed.
  const geom =
    typeof trip.routeGeom === "string"
      ? (() => { try { return JSON.parse(trip.routeGeom); } catch { return null; } })()
      : trip.routeGeom && Array.isArray(trip.routeGeom.coordinates)
        ? trip.routeGeom
        : null;

  return (
    <div className="dr-map">
      <Suspense fallback={<div className="dr-map-loading">Loading map…</div>}>
        <MapView
          markers={markers}
          routes={geom ? [{ id: "planned", geometry: geom, color: "#2455d6", width: 4 }] : []}
          fitTo={markers.map((m) => [m.lng, m.lat])}
          /* the card's map is 168px tall; the default 60px of padding would
             reserve most of that and zoom out to the whole island */
          fitPadding={22}
          height="100%"
          interactive={false}
        />
      </Suspense>
    </div>
  );
}

/** The run in progress: what it is, where it has got to, and where it is going. */
function CurrentTrip({ trip, onOpen }) {
  const live = trip.status === "in_transit";
  // A run that is finished is neither current nor next, and calling it "next"
  // tells the driver to go and do it again.
  const heading = live ? "Current run" : trip.status === "delivered" ? "Last run" : "Next run";
  return (
    <button className={`dr-current${live ? " moving" : ""}`} onClick={() => onOpen(trip.id)}>
      <div className="dr-current-top">
        <div className="dr-current-row">
          <div>
            <div className="dr-current-label">{heading}</div>
            <div className="dr-current-no">{trip.ticketNo}</div>
          </div>
          {live
            ? <span className="dr-chip-live">In transit</span>
            : <span className="dr-chip-live" style={{ background: "rgba(255,255,255,.14)" }}>
                {trip.status.replace(/_/g, " ")}
              </span>}
        </div>
      </div>

      {/* The truck this run is on, standing on a strip of road that only moves
          while the run does. */}
      <div className="dr-veh-panel">
        {trip.vehicle && <span className="dr-veh-badge">{trip.vehicle}</span>}
        <VehiclePhoto
          vehicleType={trip.vehicleType}
          status={trip.status}
          className="dr-veh-photo"
        />
      </div>
      <div className="dr-veh-road" />

      <TripMap trip={trip} />

      <div className="dr-current-body">
        <TripTrack status={trip.status} />

        <div className="dr-legs">
          <span className="dr-leg">
            <span className="dr-leg-label">From</span>
            <span className="dr-leg-place">{shortPlace(trip.origin)}</span>
          </span>
          {/* distance only when the route was actually computed */}
          {trip.routeKm ? (
            <span className="dr-leg-gap">{trip.routeKm} km</span>
          ) : null}
          <span className="dr-leg to">
            <span className="dr-leg-label">To</span>
            <span className="dr-leg-place">{shortPlace(trip.destination)}</span>
          </span>
        </div>
      </div>
    </button>
  );
}

/** An empty yard: a road with nothing on it. Static — there is no activity to
 *  represent, and animating "nothing is happening" is just noise. */
function EmptyRoad() {
  return (
    <svg
      className="dr-empty-art"
      width="120" height="40" viewBox="0 0 120 40"
      fill="none" aria-hidden="true"
    >
      <line x1="8" y1="26" x2="112" y2="26" stroke="var(--dr-line)" strokeWidth="2" strokeLinecap="round" />
      <circle cx="8" cy="26" r="4" fill="var(--dr-card)" stroke="var(--dr-line)" strokeWidth="2" />
      <circle cx="112" cy="26" r="4" fill="var(--dr-card)" stroke="var(--dr-line)" strokeWidth="2" />
      <line x1="34" y1="26" x2="46" y2="26" stroke="var(--dr-line-soft)" strokeWidth="2" strokeLinecap="round" />
      <line x1="58" y1="26" x2="70" y2="26" stroke="var(--dr-line-soft)" strokeWidth="2" strokeLinecap="round" />
      <line x1="82" y1="26" x2="94" y2="26" stroke="var(--dr-line-soft)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function TripList({ onOpen }) {
  const [trips, setTrips] = useState(null);
  const [err, setErr] = useState("");

  const load = () => driverTrips().then(setTrips).catch((e) => setErr(e.message));
  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, []);

  if (err) return <div className="dr-scroll"><div className="dr-err">{err}</div></div>;
  if (!trips) return <div className="dr-scroll" style={{ color: "var(--dr-text-2)" }}>Loading…</div>;

  const [current, ...rest] = trips;

  return (
    <div className="dr-scroll">
      <CapabilityNotice />

      {trips.length === 0 && (
        <div className="dr-empty">
          <EmptyRoad />
          <div className="dr-empty-title">No active trips</div>
          <div className="dr-empty-sub">You&rsquo;re clear for now.</div>
        </div>
      )}

      {/* The run in progress gets the card. The API already sorts in_transit
          first, so the head of the list is the one that matters. */}
      {current && <CurrentTrip trip={current} onOpen={onOpen} />}

      {rest.length > 0 && (
        <>
          <div className="dr-section">
            <span className="dr-section-title">Also assigned</span>
            <span className="dr-section-count">{rest.length}</span>
          </div>
          {rest.map((t) => (
            <button key={t.id} className="dr-row" onClick={() => onOpen(t.id)}>
              <span className="dr-row-art">
                <TripVehicle vehicleType={t.vehicleType} status={t.status} height={30} muted />
              </span>
              <span className="dr-row-main">
                <span className="dr-row-no">{t.ticketNo}</span>
                <span className="dr-row-route">{shortPlace(t.destination)}</span>
              </span>
              <span className={`dr-pill ${t.status}`}>{t.status.replace(/_/g, " ")}</span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}
