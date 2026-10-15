import { useEffect, useRef, useState } from "react";
import { isNativeApp } from "../platform";
import { readTheme, resolvedTheme } from "../theme/theme";

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
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  meta.content = resolvedTheme(readTheme()) === "dark" ? "#0c111b" : "#f1f5fb";
  // a service worker is refused outright on an insecure origin, so over plain
  // http from another device the app simply is not installable
  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker
      .register("/driver-sw.js", { scope: "/driver" })
      .catch(() => { /* unsupported or blocked — the app still works online */ });
  }
}


import { currentDriverId, getDriverAuth, setDriverAuth, clearDriverAuth, driverLogin, driverMe, driverSupportUnread, driverTrips, driverUnread } from "./driverApi";
import DriverAvatar from "./DriverAvatar";
import DriverTripScreen from "./DriverTripScreen";
import CapabilityNotice from "./CapabilityNotice";
import TrackingScene from "../components/login/TrackingScene";
import DriverHighway from "./DriverHighway";
import { TripTrack, TripVehicle, greeting, RouteTimeline, StatTile, fmtDuration } from "./DriverBits";
import VehiclePhoto from "./VehiclePhoto";
import DriverTabBar from "./DriverTabBar";
import DriverAgreementGate from "./DriverAgreementGate";
import DriverProfile from "./DriverProfile";
import DriverHistory from "./DriverHistory";
import DriverClaims from "./DriverClaims";
import DriverThemeToggle from "./DriverThemeToggle";
import DriverLoader from "./DriverLoader";
import DriverBell from "./DriverBell";
import LicenceNotice from "./LicenceNotice";
import OfflineBar from "./OfflineBar";
import { clearQueue, pendingCount } from "./offlineQueue";
import { onHardwareBack, settleChrome, tap } from "./native";

import "./driver.css";

export default function DriverApp() {
  useEffect(installDriverPwa, []);
  useEffect(settleChrome, []);

  const [auth, setAuth] = useState(getDriverAuth());
  // The driver's own record, for the picture on Home. Loaded once after sign-in
  // and kept current by Profile, so an upload there shows on Home straight away.
  const [profile, setProfile] = useState(null);
  // Re-read on a slow timer and on returning to the app. The licence in it is the
  // office's record and they can change it at any time — a renewal entered, a new
  // photo — so the banner and the bell must follow it rather than keep showing
  // what was true at sign-in.
  useEffect(() => {
    if (!auth) { setProfile(null); return undefined; }
    let dead = false;
    const load = () => driverMe()
      .then((p) => { if (!dead) setProfile(p); })
      .catch(() => { /* the initials stand in until the next load */ });
    load();
    const id = window.setInterval(load, 60000);
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      dead = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [auth]);
  const [tripId, setTripId] = useState(null);
  const [tab, setTab] = useState("trips");
  const [profileView, setProfileView] = useState("overview");
  // A record opened from History or Claims (a run, a claim, a new claim). It is
  // held here so the phone's back button can close it before leaving the tab.
  const [tabDetail, setTabDetail] = useState(null);
  // "pushing" when a trip was opened, "popping" on the way back, so the
  // screens travel in the direction the driver moved.
  const [nav, setNav] = useState(null);

  // chatFirst: arrived from the bell, so the conversation opens with the trip.
  const [chatFirst, setChatFirst] = useState(false);
  // "details" or "route" inside an open trip; held here so back can step out of the route first.
  const [tripView, setTripView] = useState("details");
  const openTrip = (id, chat = false) => { setNav("pushing"); setChatFirst(chat); setTripView("details"); setTripId(id); tap("light"); };
  // Help & Support opened from somewhere else (a run with something wrong on it).
  // It lives under Profile, so this moves there and opens the screen asked for.
  const openHelp = (detail) => {
    setTripId(null);
    setNav(null);
    setChatFirst(false);
    setTripView("details");
    setTab("profile");
    setProfileView("support");
    setTabDetail(detail || null);
  };
  const closeTrip = () => { setNav("popping"); setChatFirst(false); setTripView("details"); setTripId(null); };
  // The licence notice on Home and in the bell lands on the licence itself, not
  // on a Profile overview the driver then has to find it in.
  const openLicence = () => {
    setTripId(null);
    setNav(null);
    setTabDetail(null);
    setTab("profile");
    setProfileView("licence");
  };

  // Moving between tabs is lateral, not up or down a hierarchy, so it clears
  // the push/pop direction first. Without this a tab switch inherits whatever
  // the last trip did and slides in from the side like a screen being popped.
  const changeTab = (next) => {
    setNav(null);
    setProfileView("overview");
    setTabDetail(null);
    setTab(next);
  };

  // Android's back button closes the app from any screen unless something
  // claims the press. Profile details sit below the Profile tab; after that,
  // the driver goes back to Today, then out. Dropping a driver onto the home
  // screen from the Claims tab because back meant "exit" is the kind of thing
  // that makes an app feel like a web page in a frame.
  useEffect(() => onHardwareBack(() => {
    if (tripId != null) {
      if (tripView === "route") { setTripView("details"); return true; }
      closeTrip();
      return true;
    }
    if (tabDetail) { setTabDetail(null); return true; }
    if (tab === "profile" && profileView !== "overview") {
      setProfileView("overview");
      return true;
    }
    if (tab !== "trips") { changeTab("trips"); return true; }
    return false;
  }), [tripId, tripView, profileView, tab, tabDetail]);

  // Dispatch messages this driver has not read, by trip — shown on the trip
  // list and the Today tab, so a message is seen without opening every trip.
  // The phone has no live socket, so this is checked on a slow timer and on
  // returning to the app; an open trip keeps its own count, so this pauses.
  const [unreadRows, setUnreadRows] = useState([]);
  useEffect(() => {
    if (!auth || tripId != null) return undefined;
    const load = () => driverUnread()
      .then(setUnreadRows)
      .catch(() => { /* a badge is a convenience; keep the last count */ });
    load();
    const id = window.setInterval(load, 30000);
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [auth, tripId]);
  // Answers from the office on Help & Support the driver has not read — the dot
  // on the help button. Checked on a slow timer, on returning to the app, and
  // whenever the driver leaves a request, so reading one clears its dot at once.
  const [supportUnread, setSupportUnread] = useState(0);
  useEffect(() => {
    if (!auth) { setSupportUnread(0); return undefined; }
    const load = () => driverSupportUnread()
      .then(setSupportUnread)
      .catch(() => { /* a dot is a convenience; keep the last count */ });
    load();
    const id = window.setInterval(load, 60000);
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [auth, profileView, tabDetail]);
  const unreadByTrip = Object.fromEntries(unreadRows.map((r) => [r.tripId, r.unread]));
  const totalUnread = unreadRows.reduce((n, r) => n + r.unread, 0);

  // The ring shown for a moment after signing in and after signing out.
  const [handoff, setHandoff] = useState(null);
  const handoffTimer = useRef(null);
  useEffect(() => () => window.clearTimeout(handoffTimer.current), []);
  const showHandoff = (label, ms) => {
    window.clearTimeout(handoffTimer.current);
    setHandoff(label);
    handoffTimer.current = window.setTimeout(() => setHandoff(null), ms);
  };

  const signOut = async () => {
    const ownerId = currentDriverId();
    const queued = ownerId ? await pendingCount(ownerId) : { total: 0 };
    if (
      queued.total > 0 &&
      !window.confirm(
        `This phone still has ${queued.total} saved update${queued.total === 1 ? "" : "s"} waiting to send. Sign out and remove them?`,
      )
    ) {
      return;
    }
    if (ownerId && queued.total > 0) await clearQueue(ownerId);
    showHandoff("Signing out…", 1200);
    clearDriverAuth();
    setAuth(null);
    setTripId(null);
    setProfileView("overview");
    setTabDetail(null);
    setTab("trips");
  };

  if (!auth) {
    return (
      <div className="dr">
        <Login
          onSuccess={(a) => { showHandoff("Signing you in…", 1400); setDriverAuth(a); setAuth(a); }}
        />
        {handoff && <DriverLoader label={handoff} />}
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
    <div className="dr" data-tab={tab}>
      <DriverAgreementGate onDecline={signOut}>
        {!inTrip && !tabDetail && !(tab === "profile" && profileView !== "overview") && (
          <ScreenHead tab={tab} name={auth.driver?.name} unread={unreadRows} onOpenTrip={(id) => openTrip(id, true)} profile={profile}
            onOpenLicence={openLicence}
            supportUnread={supportUnread} onOpenSupport={() => { setTabDetail(null); setProfileView("support"); }} />
        )}
        <OfflineBar />

        {/* keyed so React remounts on navigation and the animation actually runs */}
        <div className={`dr-screen ${nav || ""}`} key={inTrip ? tripId : tab}>
          {inTrip ? (
            <DriverTripScreen tripId={tripId} onBack={closeTrip} openChat={chatFirst} view={tripView} onViewChange={setTripView} onHelp={openHelp} />
          ) : tab === "trips" ? (
            <TripList onOpen={openTrip} unread={unreadByTrip} top={<LicenceNotice licence={profile?.license} onOpen={openLicence} />} />
          ) : tab === "history" ? (
            <DriverHistory detail={tabDetail} onDetail={setTabDetail} />
          ) : tab === "claims" ? (
            <DriverClaims detail={tabDetail} onDetail={setTabDetail} />
          ) : (
            <DriverProfile
              onSignOut={signOut}
              onOpenHistory={() => changeTab("history")}
              view={profileView}
              onViewChange={setProfileView}
              onProfile={setProfile}
              detail={tabDetail}
              onDetail={setTabDetail}
              supportUnread={supportUnread}
            />
          )}
        </div>

        {!inTrip && <DriverTabBar active={tab} onChange={changeTab} badges={{ trips: totalUnread }} />}
      </DriverAgreementGate>
      {handoff && <DriverLoader label={handoff} />}
    </div>
  );
}

/**
 * The title strip above each tab.
 *
 * Today keeps the greeting, because the first thing a driver wants at 5am is
 * to be addressed rather than labelled. The other three take a plain title —
 * a greeting repeated on every tab stops meaning anything.
 */
function ScreenHead({ tab, name, unread, onOpenTrip, profile, onOpenLicence, supportUnread = 0, onOpenSupport }) {
  // The theme choice lives in Profile. Up here are the things a driver needs to
  // be told about from any tab: dispatch has written, or the licence is running out.
  const bell = <DriverBell rows={unread} onOpenTrip={onOpenTrip} licence={profile?.license} onOpenLicence={onOpenLicence} />;
  if (tab === "trips") {
    return (
      <header className="dr-home-head">
        <div className="dr-home-who">
          <DriverAvatar name={name} hasPhoto={profile?.hasPhoto} photoUpdatedAt={profile?.photoUpdatedAt} />
          <div className="dr-home-who-text">
            <div className="dr-greet">{greeting()} · {new Date().toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</div>
            <div className="dr-greet-name">{name || "Driver"}</div>
          </div>
        </div>
        {bell}
      </header>
    );
  }

  const TITLES = {
    history: ["Your runs", "Everything you have finished"],
    claims: ["Your claims", "What you have filed, and where it stands"],
    profile: ["Profile", "Your driver details and documents"],
  };
  const [title, sub] = TITLES[tab] || ["", ""];

  // On Profile the bell gives way to Help & Support: it is where a driver goes
  // to reach the office, and the one notification the bell carries — dispatch
  // has written about a trip — is on every other tab.
  const help = (
    <div className="dr-bell">
      <button
        type="button"
        className="dr-bell-btn dr-help-btn"
        aria-label={supportUnread ? `Help & Support, ${supportUnread} new` : "Help & Support"}
        onClick={() => { tap("light"); onOpenSupport?.(); }}
      >
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="4" />
          <path d="m4.93 4.93 4.24 4.24M14.83 9.17l4.24-4.24M14.83 14.83l4.24 4.24M9.17 14.83l-4.24 4.24" />
        </svg>
        <span className="dr-help-btn-label">Help</span>
        {supportUnread > 0 && <span className="dr-bell-badge">{supportUnread > 9 ? "9+" : supportUnread}</span>}
      </button>
    </div>
  );

  return (
    <header className="dr-home-head">
      <div>
        <div className="dr-head-title">{title}</div>
        <div className="dr-head-sub">{sub}</div>
      </div>
      {tab === "profile" ? help : bell}
    </header>
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

const iconProps = {
  width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
  strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true,
};

/** Whether the phone can reach the network, live. It says nothing about the server. */
function ConnectionChip() {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);
  return <span className="dr-badge" data-tone={online ? "ok" : "wait"}>{online ? "Online" : "Offline"}</span>;
}

function Login({ onSuccess }) {
  const [employeeNo, setEmployeeNo] = useState("");
  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);
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
        <DriverHighway />
        <span className="dr-hero-veil" />

        <div className="dr-login-theme">
          <DriverThemeToggle />
        </div>

        <div className="dr-hero-mark">
          <span className="dr-wordmark">Trackify</span>
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
          <div className="dr-login-head">
            <div>
              <div className="dr-login-title">Driver sign in</div>
              <div className="dr-login-sub">Enter your credentials to continue.</div>
            </div>
            <ConnectionChip />
          </div>

          <CapabilityNotice />
          <form onSubmit={submit}>
            <div style={{ marginBottom: 10 }}>
              <label className="dr-label" htmlFor="login-emp">Employee number</label>
              <div className="dr-loginfield">
                <svg {...iconProps}><circle cx="12" cy="8" r="4" /><path d="M4 20a8 8 0 0 1 16 0" /></svg>
                <input
                  id="login-emp"
                  value={employeeNo}
                  onChange={(e) => setEmployeeNo(e.target.value)}
                  placeholder="DRV-001"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  autoComplete="username"
                />
              </div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label className="dr-label" htmlFor="login-pin">PIN</label>
              <div className="dr-loginfield">
                <svg {...iconProps}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
                <input
                  id="login-pin"
                  type={showPin ? "text" : "password"}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                  placeholder="••••"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="dr-loginfield-eye"
                  aria-label={showPin ? "Hide PIN" : "Show PIN"}
                  aria-pressed={showPin}
                  onClick={() => setShowPin((v) => !v)}
                >
                  {showPin ? (
                    <svg {...iconProps}><path d="M3 3l18 18" /><path d="M10.6 6.2A9.5 9.5 0 0 1 12 6c5 0 8.5 4.5 9.5 6a14 14 0 0 1-2.7 3.2M6.5 7.6A14 14 0 0 0 2.5 12C3.5 13.5 7 18 12 18c1.4 0 2.7-.4 3.8-.9" /><path d="M9.9 10a3 3 0 0 0 4.1 4.1" /></svg>
                  ) : (
                    <svg {...iconProps}><path d="M2.5 12C3.5 10.5 7 6 12 6s8.5 4.5 9.5 6c-1 1.5-4.5 6-9.5 6s-8.5-4.5-9.5-6z" /><circle cx="12" cy="12" r="3" /></svg>
                  )}
                </button>
              </div>
            </div>
            <button className="dr-btn ink dr-login-go" disabled={busy || !employeeNo || pin.length < 4}>
              {busy ? "Signing in…" : (
                <>
                  Sign in
                  <svg {...iconProps} width="20" height="20" strokeWidth="2.2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                </>
              )}
            </button>
            {err && <div className="dr-err" role="alert">{err}</div>}
          </form>

          <p className="dr-login-help">
            Having trouble signing in?<br />Contact your dispatcher.
          </p>
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
 * The day at a glance, from the runs this driver actually has.
 *
 * Only what the trips already carry: how many runs are open, and the length and
 * expected time of the one on top. A tile whose figure was never computed is
 * left out rather than shown as zero.
 */
function DayStats({ trips, current }) {
  const open = trips.filter((t) => t.status !== "delivered").length
  const km = Number(current?.routeKm)
  const time = fmtDuration(current?.routeMin)
  const tiles = [
    { label: open === 1 ? "Open run" : "Open runs", value: open },
    Number.isFinite(km) && km > 0 ? { label: "Route", value: km % 1 ? km.toFixed(1) : km, unit: "km" } : null,
    time ? { label: "Est. drive", value: time } : null,
  ].filter(Boolean)
  return (
    <div className="dr-stats">
      {tiles.map((t) => <StatTile key={t.label} {...t} />)}
    </div>
  )
}

/** The run in progress: what it is, where it has got to, and where it is going. */
function CurrentTrip({ trip, onOpen, unread = 0 }) {
  const live = trip.status === "in_transit";
  const open = () => onOpen(trip.id);
  // A run that is finished is neither current nor next, and calling it "next"
  // tells the driver to go and do it again.
  const heading = live ? "Current run" : trip.status === "delivered" ? "Last run" : "Next run";
  return (
    <div
      className={`dr-current${live ? " moving" : ""}`}
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); open(); }
      }}
    >
      <div className="dr-current-top">
        <div className="dr-current-row">
          <div>
            <div className="dr-current-label">{heading}</div>
            <div className="dr-current-no">{trip.ticketNo} <UnreadBadge count={unread} /></div>
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

      <div className="dr-current-body">
        <TripTrack status={trip.status} />
        <RouteTimeline trip={trip} />
        {trip.cargo && <div className="dr-current-cargo"><span>Cargo</span>{trip.cargo}</div>}
      </div>

      <div className="dr-current-foot">
        <span className="dr-current-cta">
          Open run
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </span>
      </div>
    </div>
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

/* "3 new messages" on a trip, in the driver's words. */
function UnreadBadge({ count }) {
  if (!count) return null;
  return (
    <span className="dr-unread" aria-label={`${count} new message${count === 1 ? "" : "s"} from dispatch`}>
      {count}
    </span>
  );
}

function TripList({ onOpen, unread = {}, top = null }) {
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
      {top}

      {trips.length === 0 && (
        <div className="dr-empty">
          <EmptyRoad />
          <div className="dr-empty-title">No active trips</div>
          <div className="dr-empty-sub">You&rsquo;re clear for now.</div>
        </div>
      )}

      {/* The run in progress gets the card. The API already sorts in_transit
          first, so the head of the list is the one that matters. */}
      {current && <DayStats trips={trips} current={current} />}
      {current && <CurrentTrip trip={current} onOpen={onOpen} unread={unread[current.id]} />}

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
                <span className="dr-row-no">{t.ticketNo} <UnreadBadge count={unread[t.id]} /></span>
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
