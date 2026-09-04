import { useEffect, useMemo, useRef, useState } from "react";
import { X, Search, MapPin, Crosshair } from "lucide-react";
import MapView from "./MapView";
import { searchPlaces, getRoute } from "../../services/geoService";
import "./map.css";

/**
 * Pick trip origin + destination on a map.
 *
 * value:  { origin: {lat,lng,label}|null, destination: {lat,lng,label}|null }
 * onDone: (value, route|null) => void      route = { distanceKm, durationMin }
 */
export default function LocationPicker({ value, onClose, onDone }) {
  const [origin, setOrigin] = useState(value?.origin || null);
  const [destination, setDestination] = useState(value?.destination || null);
  const [target, setTarget] = useState("origin"); // which pin a map click sets
  const [route, setRoute] = useState(null);
  const [routing, setRouting] = useState(false);

  // recompute the route whenever both points are set
  useEffect(() => {
    let cancelled = false;
    if (origin?.lat && destination?.lat) {
      setRouting(true);
      getRoute(origin, destination).then((r) => {
        if (!cancelled) { setRoute(r); setRouting(false); }
      });
    } else {
      setRoute(null);
    }
    return () => { cancelled = true; };
  }, [origin?.lat, origin?.lng, destination?.lat, destination?.lng]);

  const setPoint = (which, pt) => (which === "origin" ? setOrigin(pt) : setDestination(pt));

  const handleMapClick = ({ lat, lng }) => {
    const pt = { lat, lng, label: `${lat.toFixed(5)}, ${lng.toFixed(5)}` };
    setPoint(target, pt);
    setTarget(target === "origin" ? "destination" : "origin");
  };

  const markers = useMemo(() => {
    const out = [];
    if (origin?.lat) out.push({ id: "o", lng: origin.lng, lat: origin.lat, color: "#16a34a", popupHtml: `<b>Origin</b>${esc(origin.label)}` });
    if (destination?.lat) out.push({ id: "d", lng: destination.lng, lat: destination.lat, color: "#dc2626", popupHtml: `<b>Destination</b>${esc(destination.label)}` });
    return out;
  }, [origin, destination]);

  const routes = useMemo(
    () => (route?.geometry ? [{ id: "trip", geometry: route.geometry, color: "#2455D6" }] : []),
    [route]
  );

  const fitTo = useMemo(() => {
    const p = [];
    if (origin?.lat) p.push([origin.lng, origin.lat]);
    if (destination?.lat) p.push([destination.lng, destination.lat]);
    return p.length ? p : null;
  }, [origin, destination]);

  return (
    <div
      className="tk-scope"
      style={{ position: "fixed", inset: 0, background: "var(--overlay, rgba(15,23,42,.45))", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      onMouseDown={onClose}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{ width: "min(920px, 96vw)", height: "min(640px, 92vh)", background: "var(--surface,#fff)", border: "1px solid var(--line,#e2e8f0)", borderRadius: 14, display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,.3)" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid var(--line,#e2e8f0)" }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Set trip locations</h3>
          <button onClick={onClose} aria-label="Close" style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--text-2,#64748b)" }}><X size={18} /></button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, padding: "12px 16px" }}>
          <PointField label="Origin" color="#16a34a" active={target === "origin"} point={origin}
            onFocus={() => setTarget("origin")} onPick={(pt) => setPoint("origin", pt)} onClear={() => setOrigin(null)} />
          <PointField label="Destination" color="#dc2626" active={target === "destination"} point={destination}
            onFocus={() => setTarget("destination")} onPick={(pt) => setPoint("destination", pt)} onClear={() => setDestination(null)} />
        </div>

        <div style={{ fontSize: 12, color: "var(--text-3,#94a3b8)", padding: "0 16px 8px", display: "flex", alignItems: "center", gap: 6 }}>
          <Crosshair size={13} /> Click the map to place the <b style={{ color: target === "origin" ? "#16a34a" : "#dc2626" }}>{target}</b> pin.
          {routing && <span> · calculating route…</span>}
          {route && !routing && <span> · <b>{route.distanceKm} km</b>, ~{fmtMin(route.durationMin)}</span>}
        </div>

        <div style={{ flex: 1, minHeight: 0, margin: "0 16px" }}>
          <MapView
            center={[125.6, 7.07]}
            zoom={6}
            markers={markers}
            routes={routes}
            fitTo={fitTo}
            onClick={handleMapClick}
          />
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "12px 16px", borderTop: "1px solid var(--line,#e2e8f0)" }}>
          <button className="ops-back-btn" onClick={onClose}>Cancel</button>
          <button
            className="ops-btn ops-btn-primary"
            style={{ borderRadius: 10 }}
            disabled={!origin?.lat || !destination?.lat}
            onClick={() => onDone({ origin, destination }, route)}
          >
            Use these locations
          </button>
        </div>
      </div>
    </div>
  );
}

function PointField({ label, color, active, point, onFocus, onPick, onClear }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState([]);
  const [open, setOpen] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 3) { setHits([]); return; }
    timer.current = setTimeout(async () => {
      setHits(await searchPlaces(q));
      setOpen(true);
    }, 350);
    return () => clearTimeout(timer.current);
  }, [q]);

  return (
    <div style={{ position: "relative" }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2,#475569)", display: "flex", alignItems: "center", gap: 5 }}>
        <MapPin size={12} style={{ color }} /> {label}
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3, border: `1px solid ${active ? color : "var(--line-strong,#cbd5e1)"}`, borderRadius: 8, padding: "5px 8px", background: "var(--surface,#fff)" }}
        onClick={onFocus}>
        <Search size={13} style={{ color: "var(--text-3,#94a3b8)", flexShrink: 0 }} />
        <input
          value={q}
          onFocus={onFocus}
          onChange={(e) => setQ(e.target.value)}
          placeholder={point?.label ? point.label.slice(0, 42) : "Search a place…"}
          style={{ border: "none", outline: "none", width: "100%", fontSize: 13, background: "transparent", color: "var(--text,#0f172a)" }}
        />
        {point && (
          <button onClick={(e) => { e.stopPropagation(); onClear(); setQ(""); }} style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--text-3,#94a3b8)" }}>
            <X size={13} />
          </button>
        )}
      </div>
      {point?.lat && (
        <div style={{ fontSize: 11, color: "var(--text-3,#94a3b8)", marginTop: 2 }}>
          {Number(point.lat).toFixed(5)}, {Number(point.lng).toFixed(5)}
        </div>
      )}
      {open && hits.length > 0 && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 20, background: "var(--surface,#fff)", border: "1px solid var(--line,#e2e8f0)", borderRadius: 8, marginTop: 3, maxHeight: 180, overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,.14)" }}>
          {hits.map((h, i) => (
            <button
              key={i}
              onClick={() => { onPick({ lat: h.lat, lng: h.lng, label: h.label }); setQ(""); setHits([]); setOpen(false); }}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 10px", border: "none", borderBottom: "1px solid var(--line,#f1f5f9)", background: "transparent", cursor: "pointer", fontSize: 12, color: "var(--text,#0f172a)" }}
            >
              {h.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const esc = (s) => `<span>${String(s || "").replace(/[<>&]/g, "")}</span>`;
const fmtMin = (m) => (m == null ? "—" : m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`);
