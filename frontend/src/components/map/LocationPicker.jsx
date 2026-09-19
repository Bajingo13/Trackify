import { useEffect, useMemo, useRef, useState } from "react";
import { X, Search, MapPin, Crosshair, Plus, ArrowUp, ArrowDown } from "lucide-react";
import MapView from "./MapView";
import { searchPlacesBest, getRoute, describePoint, PRECISION_LABEL, isDeliverable } from "../../services/geoService";
import "./map.css";

/**
 * Pick trip origin + destination (+ optional ordered stops) on a map.
 *
 * value:  { origin: {lat,lng,label}|null, destination: {lat,lng,label}|null, stops?: [{lat,lng,label}] }
 * onDone: (value, route|null) => void      route = { distanceKm, durationMin, geometry }
 */

/*
 * The whole country, because a dispatcher may be anywhere in it.
 *
 * This used to be [125.6, 7.07] — Davao. Anyone working in Luzon opened the
 * picker onto Mindanao and had to find their way back across the sea, which
 * read as the map being broken before a single search had run.
 */
const PH_CENTRE = [122.0, 12.3];
const PH_ZOOM = 5;

export default function LocationPicker({ value, onClose, onDone }) {
  const [origin, setOrigin] = useState(value?.origin || null);
  const [destination, setDestination] = useState(value?.destination || null);
  const [stops, setStops] = useState(Array.isArray(value?.stops) ? value.stops : []);
  const [target, setTarget] = useState("origin"); // "origin" | "destination" | number (stop index)
  const [route, setRoute] = useState(null);
  const [routing, setRouting] = useState(false);

  const stopsKey = stops.map((s) => (s?.lat ? `${s.lat},${s.lng}` : "-")).join("|");

  // recompute the route through origin -> stops -> destination
  useEffect(() => {
    let cancelled = false;
    if (origin?.lat && destination?.lat) {
      setRouting(true);
      getRoute(origin, destination, stops.filter((s) => s?.lat)).then((r) => {
        if (!cancelled) { setRoute(r); setRouting(false); }
      });
    } else {
      setRoute(null);
    }
    return () => { cancelled = true; };
  }, [origin?.lat, origin?.lng, destination?.lat, destination?.lng, stopsKey]);

  const place = (pt) => {
    if (target === "origin") { setOrigin(pt); if (!destination) setTarget("destination"); }
    else if (target === "destination") setDestination(pt);
    else if (typeof target === "number") setStops((prev) => prev.map((s, i) => (i === target ? pt : s)));
  };

  /**
   * A dropped pin is the most precise thing a dispatcher can do — it is the only
   * way to place a house OpenStreetMap has never heard of. It used to be the
   * least useful: the point was labelled with its own coordinates, so the trip
   * recorded "7.07345, 125.61234" and nobody downstream could read it. Now the
   * point is asked what is there.
   */
  const handleMapClick = async ({ lat, lng }) => {
    const fallback = { lat, lng, label: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, precision: "area" };
    place(fallback);
    const found = await describePoint(lat, lng);
    // Keep the clicked point, not the one the geocoder snapped to: the
    // dispatcher pointed at a gate, and the nearest mapped building is not it.
    if (found?.label) place({ ...fallback, label: found.label, precision: found.precision, address: found.address });
  };

  const addStop = () => { setStops((prev) => [...prev, null]); setTarget(stops.length); };
  const removeStop = (i) => {
    setStops((prev) => prev.filter((_, idx) => idx !== i));
    setTarget("destination");
  };
  const moveStop = (i, dir) => {
    setStops((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const markers = useMemo(() => {
    const out = [];
    if (origin?.lat) out.push({ id: "o", lng: origin.lng, lat: origin.lat, color: "#16a34a", popupHtml: `<b>Origin</b>${esc(origin.label)}` });
    stops.forEach((s, i) => {
      if (s?.lat) out.push({ id: `s${i}`, lng: s.lng, lat: s.lat, color: "#d97706", popupHtml: `<b>Stop ${i + 1}</b>${esc(s.label)}` });
    });
    if (destination?.lat) out.push({ id: "d", lng: destination.lng, lat: destination.lat, color: "#dc2626", popupHtml: `<b>Destination</b>${esc(destination.label)}` });
    return out;
  }, [origin, destination, stops]);

  const routes = useMemo(
    () => (route?.geometry ? [{ id: "trip", geometry: route.geometry, color: "#2455D6" }] : []),
    [route]
  );

  const fitTo = useMemo(() => {
    const p = [];
    if (origin?.lat) p.push([origin.lng, origin.lat]);
    stops.forEach((s) => { if (s?.lat) p.push([s.lng, s.lat]); });
    if (destination?.lat) p.push([destination.lng, destination.lat]);
    return p.length ? p : null;
  }, [origin, destination, stops]);

  const near = origin?.lat ? { lat: origin.lat, lng: origin.lng }
    : destination?.lat ? { lat: destination.lat, lng: destination.lng }
    : null;

  /*
   * The province of a point already placed, used to scope the next search.
   *
   * Setting one end of a trip says where the work is. Without it, typing
   * "Villa" with an origin in Balayan suggested Northern Samar, 415km away,
   * and four more like it — none of them in Batangas. The province is
   * preferred over the city because a trip crosses towns far more often than
   * it crosses provinces.
   */
  const scopeOf = (p) => p?.address?.province || p?.address?.city || null;
  const context = scopeOf(origin) || scopeOf(destination) || stops.map(scopeOf).find(Boolean) || null;

  const coarse = [origin, destination, ...stops].filter((p) => p?.lat && p.precision && !isDeliverable(p.precision));

  const targetLabel = target === "origin" ? "origin" : target === "destination" ? "destination" : `stop ${Number(target) + 1}`;
  const targetColor = target === "origin" ? "#16a34a" : target === "destination" ? "#dc2626" : "#d97706";

  return (
    <div
      className="tk-scope"
      style={{ position: "fixed", inset: 0, background: "var(--overlay, rgba(15,23,42,.45))", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      onMouseDown={onClose}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{ width: "min(920px, 96vw)", height: "min(680px, 94vh)", background: "var(--surface,#fff)", border: "1px solid var(--line,#e2e8f0)", borderRadius: 14, display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,.3)" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid var(--line,#e2e8f0)" }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Set trip route</h3>
          <button onClick={onClose} aria-label="Close" style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--text-2,#64748b)" }}><X size={18} /></button>
        </div>

        <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8, maxHeight: 260, overflowY: "auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <PointField label="Origin" color="#16a34a" active={target === "origin"} point={origin} near={near} context={context}
              onFocus={() => setTarget("origin")} onPick={(pt) => { setOrigin(pt); }} onClear={() => setOrigin(null)} />
            <PointField label="Destination" color="#dc2626" active={target === "destination"} point={destination} near={near} context={context}
              onFocus={() => setTarget("destination")} onPick={(pt) => setDestination(pt)} onClear={() => setDestination(null)} />
          </div>

          {stops.map((s, i) => (
            <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
              <div style={{ flex: 1 }}>
                <PointField
                  label={`Stop ${i + 1}`}
                  color="#d97706"
                  active={target === i}
                  point={s}
                  near={near}
                  context={context}
                  onFocus={() => setTarget(i)}
                  onPick={(pt) => setStops((prev) => prev.map((x, idx) => (idx === i ? pt : x)))}
                  onClear={() => setStops((prev) => prev.map((x, idx) => (idx === i ? null : x)))}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingTop: 18 }}>
                <button type="button" onClick={() => moveStop(i, -1)} disabled={i === 0} title="Move up"
                  style={iconBtn(i === 0)}><ArrowUp size={12} /></button>
                <button type="button" onClick={() => moveStop(i, 1)} disabled={i === stops.length - 1} title="Move down"
                  style={iconBtn(i === stops.length - 1)}><ArrowDown size={12} /></button>
                <button type="button" onClick={() => removeStop(i)} title="Remove stop"
                  style={{ ...iconBtn(false), color: "#dc2626" }}><X size={12} /></button>
              </div>
            </div>
          ))}

          <button type="button" onClick={addStop}
            style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: "#d97706", background: "transparent", border: "1px dashed #f0d199", borderRadius: 8, padding: "5px 10px", cursor: "pointer" }}>
            <Plus size={13} /> Add stop
          </button>
        </div>

        <div style={{ fontSize: 12, color: "var(--text-3,#94a3b8)", padding: "0 16px 8px", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <Crosshair size={13} /> Click the map to place the <b style={{ color: targetColor }}>{targetLabel}</b> pin.
          {routing && <span> · calculating route…</span>}
          {coarse.length > 0 && (
            <span style={{ color: "var(--warn,#b26a06)", fontWeight: 600 }}>
              {" "}· {coarse.length === 1 ? "One point is" : `${coarse.length} points are`} only
              accurate to a city or wider — search a street or barangay, or click the exact spot.
            </span>
          )}
          {route && !routing && <span> · <b>{route.distanceKm} km</b>, ~{fmtMin(route.durationMin)}{stops.some((s) => s?.lat) ? " through the stops" : ""}</span>}
        </div>

        <div style={{ flex: 1, minHeight: 0, margin: "0 16px" }}>
          <MapView center={PH_CENTRE} zoom={PH_ZOOM} markers={markers} routes={routes} fitTo={fitTo} onClick={handleMapClick} />
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "12px 16px", borderTop: "1px solid var(--line,#e2e8f0)" }}>
          <button className="ops-back-btn" onClick={onClose}>Cancel</button>
          <button
            className="ops-btn ops-btn-primary"
            /*
             * .ops-btn sets no padding and no text colour anywhere in the
             * stylesheet — only a background — so this button rendered with the
             * browser's default 1px and its text jammed against the edges while
             * Cancel, which carries its own padding, looked correct beside it.
             * Styled here rather than in .ops-btn, which is used app-wide.
             */
            style={{ borderRadius: 10, padding: "8px 16px", border: "none", color: "#fff", fontSize: 13, fontWeight: 600, cursor: origin?.lat && destination?.lat ? "pointer" : "not-allowed", opacity: origin?.lat && destination?.lat ? 1 : 0.55, whiteSpace: "nowrap" }}
            disabled={!origin?.lat || !destination?.lat}
            onClick={() => onDone({ origin, destination, stops: stops.filter((s) => s?.lat) }, route)}
          >
            Use this route
          </button>
        </div>
      </div>
    </div>
  );
}

const iconBtn = (disabled) => ({
  border: "1px solid var(--line,#e2e8f0)", background: "var(--surface,#fff)", borderRadius: 5,
  width: 20, height: 18, display: "grid", placeItems: "center", cursor: disabled ? "default" : "pointer",
  color: disabled ? "var(--text-3,#cbd5e1)" : "var(--text-2,#64748b)", padding: 0,
});

function PointField({ label, color, active, point, near, context, onFocus, onPick, onClear }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState([]);
  const [status, setStatus] = useState("idle"); // idle | searching | hits | empty
  const [matched, setMatched] = useState(null); // what was found, when it isn't what was typed
  const [open, setOpen] = useState(false);
  const timer = useRef(null);

  /**
   * Search as the dispatcher types.
   *
   * `cancelled` is the whole point of the cleanup. Without it a slow earlier
   * request could land after a faster later one and overwrite it, so the list
   * under "Caloocan" showed results for the Balayan search before it — the
   * field appearing to ignore what was actually typed.
   */
  useEffect(() => {
    let cancelled = false;
    clearTimeout(timer.current);

    const text = q.trim();
    if (text.length < 3) {
      setHits([]);
      setMatched(null);
      setStatus("idle");
      return undefined;
    }

    setStatus("searching");
    timer.current = setTimeout(async () => {
      const found = await searchPlacesBest(text, near, context);
      if (cancelled) return;
      setHits(found.results);
      setMatched(found.degraded ? found.matchedQuery : null);
      setStatus(found.results.length ? "hits" : "empty");
      setOpen(true);
    }, 350);

    return () => { cancelled = true; clearTimeout(timer.current); };
  }, [q, near?.lat, near?.lng, context]);

  /**
   * Take a result, but keep the address as it was typed.
   *
   * When the search had to give something up to find a match, the words the
   * dispatcher wrote are still the address the driver needs to read — the pin
   * is simply the closest point the map knows. Recording "Balayan, Batangas"
   * over "0394 Villa Esperanza Phase 2" would throw away the only part nobody
   * can reconstruct.
   */
  const choose = (hit) => {
    const typed = q.trim();
    onPick({
      lat: hit.lat,
      lng: hit.lng,
      label: matched && typed ? typed : hit.label,
      matchedLabel: matched ? hit.label : null,
      precision: hit.precision,
      address: hit.address,
    });
    setQ("");
    setHits([]);
    setMatched(null);
    setStatus("idle");
    setOpen(false);
  };

  const showPanel = open && (status === "hits" || status === "empty");

  /**
   * Where to draw the suggestion list, in screen coordinates.
   *
   * It cannot be positioned inside this field. The fields sit in a box that
   * scrolls (maxHeight with overflow), and an absolutely positioned element is
   * clipped by any scrolling ancestor — so the list appeared with its banner
   * visible and every option underneath cut off at the boundary. The banner
   * said "picking one keeps what you typed" while the thing to pick was
   * invisible. Measuring the field and drawing the list fixed to the viewport
   * takes it out of that box, where nothing can clip it.
   */
  const boxRef = useRef(null);
  const [anchor, setAnchor] = useState(null);

  useEffect(() => {
    if (!showPanel) return undefined;
    const measure = () => {
      if (boxRef.current) setAnchor(boxRef.current.getBoundingClientRect());
    };
    measure();
    window.addEventListener("resize", measure);
    // Capture phase: the field's own container scrolls, and that scroll does
    // not bubble.
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [showPanel, hits.length, status]);

  return (
    <div style={{ position: "relative" }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2,#475569)", display: "flex", alignItems: "center", gap: 5 }}>
        <MapPin size={12} style={{ color }} /> {label}
      </label>
      <div ref={boxRef} style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3, border: `1px solid ${active ? color : "var(--line-strong,#cbd5e1)"}`, borderRadius: 8, padding: "5px 8px", background: "var(--surface,#fff)" }}
        onClick={onFocus}>
        <Search size={13} style={{ color: "var(--text-3,#94a3b8)", flexShrink: 0 }} />
        <input
          value={q}
          onFocus={onFocus}
          onChange={(e) => setQ(e.target.value)}
          placeholder={point?.label ? point.label.slice(0, 42) : "Type the whole address…"}
          style={{ border: "none", outline: "none", width: "100%", fontSize: 13, background: "transparent", color: "var(--text,#0f172a)" }}
        />
        {point && (
          <button onClick={(e) => { e.stopPropagation(); onClear(); setQ(""); }} style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--text-3,#94a3b8)" }}>
            <X size={13} />
          </button>
        )}
      </div>
      {point?.lat && (
        <div style={{ fontSize: 11, color: "var(--text-3,#94a3b8)", marginTop: 2, display: "flex", gap: 6, flexWrap: "wrap" }}>
          <span>{Number(point.lat).toFixed(5)}, {Number(point.lng).toFixed(5)}</span>
          {point.precision && (
            <span style={{ fontWeight: 700, color: isDeliverable(point.precision) ? "var(--ok,#158a4a)" : "var(--warn,#b26a06)" }}>
              {PRECISION_LABEL[point.precision] || point.precision}
            </span>
          )}
          {point.matchedLabel && (
            <span style={{ color: "var(--warn,#b26a06)" }}>pin on {point.matchedLabel}</span>
          )}
        </div>
      )}
      {status === "searching" && q.trim().length >= 3 && (
        <div style={{ fontSize: 11, color: "var(--text-3,#94a3b8)", marginTop: 2 }}>Searching…</div>
      )}

      {showPanel && anchor && (
        <div style={{
          position: "fixed",
          top: anchor.bottom + 3,
          left: anchor.left,
          width: anchor.width,
          // Above the modal itself (9000), which is what it has to escape.
          zIndex: 9100,
          background: "var(--surface,#fff)",
          border: "1px solid var(--line,#e2e8f0)",
          borderRadius: 8,
          maxHeight: 240,
          overflowY: "auto",
          boxShadow: "0 8px 24px rgba(0,0,0,.14)",
        }}>
          {/* An empty result used to render nothing at all, which looks exactly
              like a broken search. Say what happened and what to do instead. */}
          {status === "empty" && (
            <div style={{ padding: "9px 10px", fontSize: 12, color: "var(--text-2,#475569)", lineHeight: 1.5 }}>
              <b>Not on the map.</b> “{q.trim()}” isn’t in OpenStreetMap, even in part.
              Click the exact spot on the map to place the pin yourself — the address
              you typed is kept either way.
            </div>
          )}

          {status === "hits" && matched && (
            <div style={{ padding: "8px 10px", fontSize: 11.5, color: "var(--warn,#b26a06)", background: "var(--warn-soft,#fff8ec)", lineHeight: 1.5, borderBottom: "1px solid var(--line,#f1f5f9)" }}>
              Couldn’t find that exact address. Closest match for <b>“{matched}”</b> —
              picking one keeps what you typed and pins it here.
            </div>
          )}

          {hits.map((h, i) => (
            <button
              key={i}
              onClick={() => choose(h)}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 10px", border: "none", borderBottom: "1px solid var(--line,#f1f5f9)", background: "transparent", cursor: "pointer", fontSize: 12, color: "var(--text,#0f172a)" }}
            >
              <span style={{ display: "block" }}>{h.label}</span>
              {/* A name alone cannot tell you a suggestion is in another region.
                  The number can: "Barangay Villa — 415 km away" is obviously
                  not the Villa anybody meant. */}
              {Number.isFinite(h.distanceKm) && (
                <span style={{ fontSize: 10.5, color: h.distanceKm > 120 ? "var(--warn,#b26a06)" : "var(--text-3,#94a3b8)" }}>
                  {h.distanceKm} km away ·{" "}
                </span>
              )}
              {h.precision && (
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".03em", textTransform: "uppercase", color: isDeliverable(h.precision) ? "var(--ok,#158a4a)" : "var(--warn,#b26a06)" }}>
                  {PRECISION_LABEL[h.precision] || h.precision}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const esc = (s) => `<span>${String(s || "").replace(/[<>&]/g, "")}</span>`;
const fmtMin = (m) => (m == null ? "—" : m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`);
