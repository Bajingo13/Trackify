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
  meta.content = resolvedTheme(readTheme()) === "dark" ? "#070b18" : "#f1f5fb";
  // a service worker is refused outright on an insecure origin, so over plain
  // http from another device the app simply is not installable
  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker
      .register("/driver-sw.js", { scope: "/driver" })
      .catch(() => { /* unsupported or blocked — the app still works online */ });
  }
}


import { currentDriverId, getDriverAuth, setDriverAuth, clearDriverAuth, driverLogin, driverMe, driverSupportUnreadSummary, driverTrips, driverUnread } from "./driverApi";
import DriverAvatar from "./DriverAvatar";
import DriverClock from "./DriverClock";
import { screenTextSize, useTextSize } from "./textSize";
import DriverTripScreen from "./DriverTripScreen";
import CapabilityNotice from "./CapabilityNotice";
import TrackingScene from "../components/login/TrackingScene";
import DriverPoster, { PosterTruck } from "./DriverPoster";
import astreablueLogo from "../assets/brand/astreablue-logo-on-dark.png";
import { TripTrack, TripVehicle, RouteTimeline, StatTile, fmtDuration, fmtDay } from "./DriverBits";
import { Badge, Chevron, tripBadge } from "./DriverListBits";
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
import NetToast from "./NetToast";
import { InlineSign } from "./NetSign";
import { useNetStatus } from "./netStatus";
import { clearQueue, pendingCount } from "./offlineQueue";
import { cachedTrips, clearTripCache, saveTrips, savedAtLabel } from "./tripCache";
import { onHardwareBack, settleChrome, tap } from "./native";
import { pauseReasonLabel, runStatus } from "./supportKinds";
import { closeDriverRealtime, useDriverRealtime } from "./driverRealtime";
import { resumeSharing, stopSharing, useLocationSession } from "./locationSession";

import { VerifyPhone } from "./DriverDeviceScreens";

import "./driver.css";

export default function DriverApp() {
  useEffect(installDriverPwa, []);
  useEffect(settleChrome, []);

  const [auth, setAuth] = useState(getDriverAuth());
  // Between the PIN and the app: a new phone waiting to be let in, or codes to write down.
  const [signInStep, setSignInStep] = useState(null);
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
  const textSize = useTextSize();
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
  const loadUnread = () => driverUnread()
    .then(setUnreadRows)
    .catch(() => { /* a badge is a convenience; keep the last count */ });
  useEffect(() => {
    if (!auth || tripId != null) return undefined;
    const load = loadUnread;
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
  // The same answers, one per request, are also rows in the notification bell.
  const [supportUnread, setSupportUnread] = useState(0);
  const [supportReplies, setSupportReplies] = useState([]);
  const loadSupport = () => driverSupportUnreadSummary()
    .then((s) => { setSupportUnread(s.unread); setSupportReplies(s.tickets); })
    .catch(() => { /* a dot is a convenience; keep the last count */ });
  useEffect(() => {
    if (!auth) { setSupportUnread(0); setSupportReplies([]); return undefined; }
    const load = loadSupport;
    load();
    const id = window.setInterval(load, 60000);
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [auth, profileView, tabDetail]);
  /*
   * Live: dispatch has written. The bell's counts are re-read from the server
   * (they stay the record of what is unread until it is opened), the bell rings,
   * and a banner says who wrote and what — unless the driver is already looking
   * at that very conversation, where the message simply appears.
   */
  const [incoming, setIncoming] = useState(null);
  const [ring, setRing] = useState(0);
  const incomingTimer = useRef(null);
  useEffect(() => () => window.clearTimeout(incomingTimer.current), []);
  // Someone gave this driver's PIN on another phone. This phone is still the trusted one; say so plainly.
  const [deviceWarning, setDeviceWarning] = useState(null);
  useDriverRealtime((msg) => {
    if (msg?.type === "device:pending") { tap("heavy"); setDeviceWarning(msg.message); }
  }, Boolean(auth));

  useDriverRealtime((msg) => {
    if (msg?.type !== "chat:message") return;
    const looking = msg.channel === "trip"
      ? tripId === msg.tripId
      : tab === "profile" && tabDetail?.ticketId === msg.ticketId;
    if (msg.channel === "trip") loadUnread(); else loadSupport();
    if (looking) return;
    setRing((n) => n + 1);
    tap("medium");
    setIncoming(msg);
    window.clearTimeout(incomingTimer.current);
    incomingTimer.current = window.setTimeout(() => setIncoming(null), 7000);
  }, Boolean(auth));
  const openIncoming = () => {
    const msg = incoming;
    setIncoming(null);
    if (!msg) return;
    if (msg.channel === "trip") openTrip(msg.tripId, true);
    else openHelp({ ticketId: msg.ticketId });
  };

  const unreadByTrip = Object.fromEntries(unreadRows.map((r) => [r.tripId, r.unread]));
  const totalUnread = unreadRows.reduce((n, r) => n + r.unread, 0);

  // The loader shown for a moment after signing in and after signing out.
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
    // the routes kept for driving offline are this driver's: none stay for the next
    if (ownerId) await clearTripCache(ownerId);
    showHandoff("Signing out…", 1200);
    // while this driver is still the signed-in one, so their saved trip is forgotten
    stopSharing();
    closeDriverRealtime();
    clearDriverAuth();
    setAuth(null);
    setTripId(null);
    setProfileView("overview");
    setTabDetail(null);
    setTab("trips");
  };

  const signedIn = (a) => {
    setDriverAuth({ token: a.token, driver: a.driver });
    setSignInStep(null);
    showHandoff("Signing you in…", 1400);
    setAuth({ token: a.token, driver: a.driver });
  };

  if (!auth) {
    return (
      <div className="dr">
        {signInStep?.kind === "pending" ? (
          <VerifyPhone
            pending={signInStep.pending}
            onSignedIn={signedIn}
            onCancel={() => setSignInStep(null)}
          />
        ) : (
          <Login
            onSuccess={(a) => {
              if (a.status === "device_verification_required") setSignInStep({ kind: "pending", pending: a });
              else signedIn(a);
            }}
          />
        )}
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
        <LocationResume />
        {deviceWarning && (
          <div className="dr-err" role="alert" style={{ margin: "10px 16px 0" }}>
            {deviceWarning}
            <button className="dr-btn ghost" style={{ marginTop: 8 }} onClick={() => setDeviceWarning(null)}>OK</button>
          </div>
        )}
        {!inTrip && !tabDetail && !(tab === "profile" && profileView !== "overview") && (
          <ScreenHead tab={tab} name={auth.driver?.name} unread={unreadRows} onOpenTrip={(id) => openTrip(id, true)} profile={profile}
            onOpenLicence={openLicence}
            supportUnread={supportUnread} onOpenSupport={() => { setTabDetail(null); setProfileView("support"); }}
            supportReplies={supportReplies} onOpenSupportTicket={(ticketId) => openHelp({ ticketId })} ring={ring} />
        )}
        {/* One floating layer for everything that drops in from the top, stacked
            rather than overlapping, and never pushing the screen under it down. */}
        <div className="dr-netlayer">
          {incoming && (
            <button type="button" className="dr-incoming" onClick={openIncoming} aria-live="polite">
              <span className="dr-incoming-from">
                {incoming.channel === "trip" ? `Dispatch · ${incoming.ticketNo || "your run"}` : `Dispatch replied · ${incoming.ticketNo}`}
              </span>
              <span className="dr-incoming-text">{incoming.preview || "New message"}</span>
              <span className="dr-incoming-go">Open</span>
            </button>
          )}
          <OfflineBar />
          <NetToast />
        </div>

        {/* keyed so React remounts on navigation and the animation actually runs */}
        {/* Text size enlarges the reading screens only, never a run and its map (textSize.js). */}
        <div
          className={`dr-screen ${nav || ""}`}
          key={inTrip ? tripId : tab}
          data-textsize={screenTextSize(inTrip, textSize)}
        >
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
 * Picks up location sharing the app was doing when it was last closed.
 *
 * Inside the Agreement gate on purpose: the Agreement is the driver's consent
 * to location collection, so nothing is shared before it is accepted.
 */
function LocationResume() {
  useEffect(() => { void resumeSharing(); }, []);
  return null;
}

/**
 * The title strip above each tab.
 *
 * Today keeps the greeting, because the first thing a driver wants at 5am is
 * to be addressed rather than labelled. The other three take a plain title —
 * a greeting repeated on every tab stops meaning anything.
 */
function ScreenHead({ tab, name, unread, onOpenTrip, profile, onOpenLicence, supportUnread = 0, onOpenSupport, supportReplies = [], onOpenSupportTicket, ring = 0 }) {
  // The theme choice lives in Profile. Up here are the things a driver needs to
  // be told about from any tab: dispatch has written about a run or answered a
  // Help & Support request, or the licence is running out.
  const bell = (
    <DriverBell rows={unread} onOpenTrip={onOpenTrip} licence={profile?.license} onOpenLicence={onOpenLicence}
      support={supportReplies} onOpenSupport={onOpenSupportTicket} ring={ring} />
  );
  if (tab === "trips") {
    return (
      <header className="dr-home-head">
        <div className="dr-home-who">
          <DriverAvatar name={name} hasPhoto={profile?.hasPhoto} photoUpdatedAt={profile?.photoUpdatedAt} />
          <div className="dr-home-who-text">
            <DriverClock name={name} />
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
  // to reach the office, and its count shows the office has answered. The bell,
  // with those same replies, is on every other tab.
  const help = (
    <div className="dr-bell">
      <button
        type="button"
        className="dr-bell-btn dr-help-btn"
        aria-label={supportUnread ? `Help & Support, ${supportUnread} new` : "Help & Support"}
        onClick={() => { tap("light"); onOpenSupport?.(); }}
      >
        <span className="dr-help-btn-icon" aria-hidden="true">
          <svg className="dr-help-headset" width="22" height="22" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 13v-1a8 8 0 0 1 16 0v1" />
            <path d="M3 13.25A1.25 1.25 0 0 1 4.25 12H6v7H4.25A1.25 1.25 0 0 1 3 17.75v-4.5Z" />
            <path d="M21 13.25A1.25 1.25 0 0 0 19.75 12H18v7h1.75A1.25 1.25 0 0 0 21 17.75v-4.5Z" />
            <path d="M20 18.5v.25A2.75 2.75 0 0 1 17.25 21.5H14" />
            <circle cx="13" cy="21.5" r="1" fill="currentColor" stroke="none" />
          </svg>
        </span>
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

/** Whether the server can be reached, live (netStatus): Online, Slow or Offline. */
function ConnectionChip() {
  const net = useNetStatus();
  const label = net === "online" ? "Online" : net === "unstable" ? "Slow" : "Offline";
  return <span className="dr-badge" data-tone={net === "online" ? "ok" : "wait"}>{label}</span>;
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
      const res = await driverLogin(employeeNo.trim().toUpperCase(), pin.trim());
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
        <DriverPoster />
        <span className="dr-hero-veil" />

        <div className="dr-login-theme">
          <DriverThemeToggle />
        </div>

        <div className="dr-hero-mark">
          <img className="dr-wordmark" src={astreablueLogo} alt="AstreaBlue" draggable="false" />
        </div>

        <PosterTruck />

        <div className="dr-shot-copy">
          <h1 className="dr-headline">
            Every run.<br />Start to <span className="dr-headline-accent">signature.</span>
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
                  onChange={(e) => {
                    // uppercase in place, so the caret stays where the driver is typing
                    const el = e.target;
                    const { selectionStart, selectionEnd } = el;
                    el.value = el.value.toUpperCase();
                    el.setSelectionRange(selectionStart, selectionEnd);
                    setEmployeeNo(el.value);
                  }}
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
export function DayStats({ trips, current }) {
  const open = trips.filter((t) => t.status !== "delivered").length
  const km = Number(current?.routeKm)
  const time = fmtDuration(current?.routeMin)
  const tiles = [
    { label: open === 1 ? "Open run" : "Open runs", value: open },
    Number.isFinite(km) && km > 0 ? { label: "Route", value: km % 1 ? km.toFixed(1) : km, unit: "km" } : null,
    time ? { label: "Est. drive", value: time } : null,
  ].filter(Boolean)
  // One column per tile. The History screen's .dr-stats rule fixes two columns,
  // which on Today left an empty grey cell beside a lone "Open run" (a run with
  // no planned route) or under the third tile.
  return (
    <div className="dr-stats dr-day-stats" style={{ gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))` }}>
      {tiles.map((t) => <StatTile key={t.label} {...t} />)}
    </div>
  )
}

/** The run in progress: what it is, where it has got to, and where it is going. */
function CurrentTrip({ trip, onOpen, unread = 0 }) {
  const live = trip.status === "in_transit";
  // Held by a pause: still the current run, but the truck is not moving.
  const run = runStatus(trip.status, trip.pauseStatus);
  const held = run.key === "paused" || run.key === "pause_pending";
  const open = () => onOpen(trip.id);
  // Sharing runs for the whole app now, so the card says when it is on: a
  // driver outside the trip screen can see dispatch still has the truck.
  const location = useLocationSession();
  const sharingHere = location.sharing && location.tripId === Number(trip.id);
  // A run that is finished is neither current nor next, and calling it "next"
  // tells the driver to go and do it again.
  const heading = live ? "Current run" : trip.status === "delivered" ? "Last run" : "Next run";
  return (
    <div
      className={`dr-current${live && !held ? " moving" : ""}${held ? " held" : ""}`}
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
          {held
            ? <span className={`dr-chip-live ${run.key}`} title={trip.pauseReason ? pauseReasonLabel(trip.pauseReason) : undefined}>{run.label}</span>
            : live
              ? <span className="dr-chip-live">{tripBadge(trip.status).label}</span>
              : <span className="dr-chip-live" style={{ background: "rgba(255,255,255,.14)" }}>
                  {tripBadge(trip.status).label}
                </span>}
        </div>
        {held && trip.pauseReason && (
          <div className="dr-current-held">
            {run.key === "paused" ? "Delivery paused" : "Waiting for the office"} · {pauseReasonLabel(trip.pauseReason)}
          </div>
        )}
      </div>

      {/* The truck this run is on, standing on a strip of road that only moves
          while the run does. */}
      <div className="dr-veh-panel">
        {trip.vehicle && <span className="dr-veh-badge">{trip.vehicle}</span>}
        <VehiclePhoto
          vehicleType={trip.vehicleType}
          status={held ? run.key : trip.status}
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
        {sharingHere && (
          <span className="dr-current-share" role="status">
            <span className="dr-current-share-dot" aria-hidden="true" />
            Sharing location
          </span>
        )}
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
  const [savedAt, setSavedAt] = useState(null); // showing the copy kept on this phone (tripCache)
  const haveTrips = useRef(false);

  const load = () => driverTrips()
    .then((list) => {
      haveTrips.current = true;
      setTrips(list);
      setErr("");
      setSavedAt(null);
      void saveTrips(currentDriverId(), list);
    })
    .catch(async (e) => {
      // Out of reach with a list on screen: keep it. The No Internet bar says why.
      if (e.status == null && haveTrips.current) return;
      if (e.status == null) {
        const kept = await cachedTrips(currentDriverId());
        if (kept && !haveTrips.current) {
          haveTrips.current = true;
          setTrips(kept.data);
          setSavedAt(kept.savedAt);
          return;
        }
      }
      setErr(e.message);
    });
  // a pause approved or ended by the office: the run card changes now
  useDriverRealtime((msg) => { if (msg?.type === "trip:pause") load(); });
  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, []);
  // back online, confirmed: the server's list replaces the saved copy now, not in 30s
  const net = useNetStatus();
  const lastNet = useRef(net);
  useEffect(() => {
    if (net !== "offline" && lastNet.current === "offline") load();
    lastNet.current = net;
  }, [net]);

  if (err && !trips) return <div className="dr-scroll"><div className="dr-err">{err}</div></div>;
  if (!trips) return <div className="dr-scroll"><DriverLoader variant="screen" label="Loading your trips…" /></div>;

  const [current, ...rest] = trips;

  return (
    <div className="dr-scroll">
      <CapabilityNotice />
      {top}
      {savedAt && (
        <InlineSign tone="info" icon="history" label={`Saved copy · ${savedAtLabel(savedAt)}`} role="status">
          Kept on this phone. Your runs and routes still open, and update when you are back online.
        </InlineSign>
      )}
      {/* The server refused a refresh: say so, rather than pass the list off as current. */}
      {err && <div className="dr-err" role="alert">Could not refresh your trips: {err}</div>}

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
            <span className="dr-section-copy">
              <span className="dr-section-title">Also assigned</span>
              <span className="dr-section-sub">Next runs, by departure</span>
            </span>
            <span className="dr-section-count">{rest.length}</span>
          </div>
          {/* The Claims card: where it is going, then its status and when it leaves. */}
          <div className="dr-claim-list">
            {rest.map((t) => {
              const badge = tripBadge(t.status, t.pauseStatus);
              const leaves = t.status === "delivered" ? null : fmtDay(t.scheduledDeparture);
              return (
                <button key={t.id} type="button" className="dr-claim tap dr-claim--lead" data-tone={badge.tone} onClick={() => onOpen(t.id)}
                  aria-label={`${t.ticketNo}, to ${shortPlace(t.destination)}, ${badge.label}${leaves ? `, leaves ${leaves}` : ""}`}>
                  <span className="dr-lead-art" aria-hidden="true">
                    <TripVehicle vehicleType={t.vehicleType} status={t.status} height={26} muted />
                  </span>
                  <span className="dr-claim-main">
                    {/* Laid out as a claim is: where it goes, and when it leaves where a
                        claim shows its amount; then its status and the facts. */}
                    <span className="dr-claim-top">
                      <span className="dr-claim-cat">
                        {shortPlace(t.destination)}
                        <UnreadBadge count={unread[t.id]} />
                      </span>
                      {leaves && <span className="dr-claim-amt dr-trip-leaves">{leaves}</span>}
                    </span>
                    <span className="dr-claim-line">
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                      <span className="dr-claim-meta">
                        <span>From {shortPlace(t.origin)}</span>
                        <span className="dr-hist-no">{t.ticketNo}</span>
                      </span>
                    </span>
                  </span>
                  <Chevron />
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
