import { useEffect, useState } from "react";

/**
 * Makes the driver app installable, without touching the staff app.
 *
 * index.html is shared by both, so the manifest and theme colour are attached
 * at runtime from here, and the service worker is registered against the
 * /driver scope only — the staff app is never served from a cache.
 */
function installDriverPwa() {
  if (!document.querySelector('link[rel="manifest"]')) {
    const link = document.createElement("link");
    link.rel = "manifest";
    link.href = "/driver-manifest.webmanifest";
    document.head.appendChild(link);
  }
  if (!document.querySelector('meta[name="theme-color"]')) {
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.content = "#0f172a";
    document.head.appendChild(meta);
  }
  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker
      .register("/driver-sw.js", { scope: "/driver" })
      .catch(() => { /* unsupported or blocked — the app still works online */ });
  }
}


import { getDriverAuth, setDriverAuth, clearDriverAuth, driverLogin, driverTrips } from "./driverApi";
import DriverTripScreen from "./DriverTripScreen";
import "./driver.css";

export default function DriverApp() {
  useEffect(installDriverPwa, []);

  const [auth, setAuth] = useState(getDriverAuth());
  const [tripId, setTripId] = useState(null);

  const signOut = () => { clearDriverAuth(); setAuth(null); setTripId(null); };

  if (!auth) {
    return (
      <div className="dr">
        <Login
          onSuccess={(a) => { setDriverAuth(a); setAuth(a); }}
        />
      </div>
    );
  }

  return (
    <div className="dr">
      <div className="dr-topbar">
        <span className="brand">Trackify Driver</span>
        <span className="who">{auth.driver?.name} · <button onClick={signOut} style={{ background: "none", border: "none", color: "#60a5fa", cursor: "pointer" }}>Sign out</button></span>
      </div>
      {tripId ? (
        <DriverTripScreen tripId={tripId} onBack={() => setTripId(null)} />
      ) : (
        <TripList onOpen={setTripId} />
      )}
    </div>
  );
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
      setErr(e2.message || "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dr-scroll" style={{ display: "flex", flexDirection: "column", justifyContent: "center", maxWidth: 380, margin: "0 auto" }}>
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <div style={{ fontSize: 26, fontWeight: 800 }}>Trackify Driver</div>
        <div style={{ color: "var(--dr-text-2)", marginTop: 4 }}>Sign in to see your trips</div>
      </div>
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
        <button className="dr-btn" disabled={busy || !employeeNo || pin.length < 4}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        {err && <div className="dr-err">{err}</div>}
      </form>
    </div>
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

  return (
    <div className="dr-scroll">
      <div style={{ fontSize: 13, color: "var(--dr-text-2)", marginBottom: 10 }}>
        {trips.length} {trips.length === 1 ? "trip" : "trips"}
      </div>
      {trips.length === 0 && (
        <div className="dr-card" style={{ textAlign: "center", color: "var(--dr-text-2)" }}>
          No trips assigned to you right now.
        </div>
      )}
      {trips.map((t) => (
        <button key={t.id} className="dr-card" style={{ display: "block", width: "100%", textAlign: "left", cursor: "pointer" }} onClick={() => onOpen(t.id)}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontWeight: 800 }}>{t.ticketNo}</span>
            <span className={`dr-pill ${t.status}`}>{t.status.replace(/_/g, " ")}</span>
          </div>
          <div style={{ fontSize: 15 }}>{t.origin} → {t.destination}</div>
          <div style={{ fontSize: 13, color: "var(--dr-text-2)", marginTop: 4 }}>
            {t.customer}{t.vehicle ? ` · ${t.vehicle}` : ""}{t.routeKm ? ` · ${t.routeKm} km` : ""}
          </div>
        </button>
      ))}
    </div>
  );
}
