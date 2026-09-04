/**
 * Geocoding + routing helpers.
 *
 * Keyless by default:
 *   - geocoding  → Nominatim (OpenStreetMap)          https://nominatim.openstreetmap.org
 *   - routing    → public OSRM demo server            https://router.project-osrm.org
 *
 * Optional upgrades via env (higher production limits):
 *   ORS_API_KEY        → routing switches to OpenRouteService
 *   NOMINATIM_URL      → point at a self-hosted Nominatim
 *   OSRM_URL           → point at a self-hosted OSRM
 */

const NOMINATIM = (process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org").replace(/\/$/, "");
const OSRM = (process.env.OSRM_URL || "https://router.project-osrm.org").replace(/\/$/, "");
const ORS_KEY = process.env.ORS_API_KEY || "";
const UA = "AstreaBlueTrackify/1.0 (fleet ops app)";

const num = (v) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

/** fetch with a hard timeout so a slow demo server can't hang the request. */
async function fetchT(url, opts = {}, ms = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** Free-text place search, biased to the Philippines. Returns up to 6 hits. */
export async function geocode(query) {
  const q = String(query || "").trim();
  if (q.length < 3) return [];
  const url = `${NOMINATIM}/search?format=jsonv2&limit=6&countrycodes=ph&addressdetails=0&q=${encodeURIComponent(q)}`;
  const r = await fetchT(url, { headers: { "User-Agent": UA, "Accept-Language": "en" } });
  if (!r.ok) return [];
  const rows = await r.json();
  return (Array.isArray(rows) ? rows : []).map((x) => ({
    label: x.display_name,
    lat: Number(x.lat),
    lng: Number(x.lon),
  }));
}

/**
 * Driving route between two {lat,lng} points, optionally through ordered
 * waypoints (intermediate trip stops).
 * @param {{lat,lng}} from
 * @param {{lat,lng}} to
 * @param {{lat,lng}[]} [waypoints]  ordered stops between from and to
 * @returns { distanceKm, durationMin, geometry } | null   (geometry = GeoJSON LineString)
 */
export async function route(from, to, waypoints = []) {
  const a = { lat: num(from?.lat), lng: num(from?.lng) };
  const b = { lat: num(to?.lat), lng: num(to?.lng) };
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;

  const wps = (Array.isArray(waypoints) ? waypoints : [])
    .map((w) => ({ lat: num(w?.lat), lng: num(w?.lng) }))
    .filter((w) => w.lat != null && w.lng != null);

  // ordered [lng,lat] pairs: origin -> stops -> destination
  const points = [[a.lng, a.lat], ...wps.map((w) => [w.lng, w.lat]), [b.lng, b.lat]];

  // Try OpenRouteService first when a key is set; fall through to the OSRM
  // demo server if ORS is unreachable or returns nothing.
  if (ORS_KEY) {
    try {
      const r = await fetchT("https://api.openrouteservice.org/v2/directions/driving-car/geojson", {
        method: "POST",
        headers: { Authorization: ORS_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ coordinates: points }),
      });
      if (r.ok) {
        const j = await r.json();
        const f = j.features?.[0];
        const s = f?.properties?.summary;
        if (f && s) {
          return {
            distanceKm: Math.round((s.distance / 1000) * 100) / 100,
            durationMin: Math.round(s.duration / 60),
            geometry: f.geometry,
          };
        }
      }
    } catch (e) {
      console.warn(`[geo] ORS route failed, falling back to OSRM: ${e.message}`);
    }
  }

  try {
    // `simplified` keeps the road shape but drops it from ~15k points to ~1-2k
    // on a long route — enough to draw, small enough to cache on the row.
    const coordPath = points.map(([lng, lat]) => `${lng},${lat}`).join(";");
    const url = `${OSRM}/route/v1/driving/${coordPath}?overview=simplified&geometries=geojson`;
    const r = await fetchT(url, { headers: { "User-Agent": UA } });
    if (!r.ok) return null;
    const j = await r.json();
    const rt = j.routes?.[0];
    if (!rt || !rt.geometry) return null;
    return {
      distanceKm: Math.round((rt.distance / 1000) * 100) / 100,
      durationMin: Math.round(rt.duration / 60),
      geometry: rt.geometry,
    };
  } catch (e) {
    console.error(`[geo] route failed: ${e.message}`);
    return null;
  }
}

/**
 * Snap a raw GPS trail to the road network so the drawn trail follows streets
 * instead of cutting straight lines across bends, water and blocks.
 * @param {{lat:number,lng:number}[]} points  ordered fixes (oldest → newest)
 * @returns GeoJSON LineString | null   (null → caller should draw the raw trail)
 */
export async function matchTrail(points) {
  const pts = (points || [])
    .map((p) => ({ lat: num(p.lat), lng: num(p.lng) }))
    .filter((p) => p.lat != null && p.lng != null);
  if (pts.length < 2) return null;
  // OSRM /match caps at 100 coordinates; thin evenly if longer.
  const capped =
    pts.length <= 100 ? pts : pts.filter((_, i) => i % Math.ceil(pts.length / 100) === 0);

  const coords = capped.map((p) => `${p.lng},${p.lat}`).join(";");
  const radiuses = capped.map(() => 50).join(";"); // 50 m search radius per point

  try {
    const url = `${OSRM}/match/v1/driving/${coords}?geometries=geojson&overview=full&radiuses=${radiuses}&tidy=true`;
    const r = await fetchT(url, { headers: { "User-Agent": UA } });
    if (!r.ok) return null;
    const j = await r.json();
    if (j.code !== "Ok" || !j.matchings?.length) return null;
    // Stitch all matched legs into one LineString.
    const line = [];
    for (const m of j.matchings) {
      const c = m.geometry?.coordinates || [];
      for (const pt of c) {
        const last = line[line.length - 1];
        if (!last || last[0] !== pt[0] || last[1] !== pt[1]) line.push(pt);
      }
    }
    return line.length >= 2 ? { type: "LineString", coordinates: line } : null;
  } catch (e) {
    console.warn(`[geo] trail match failed: ${e.message}`);
    return null;
  }
}

/** Haversine distance in km between two {lat,lng} — used to sum a GPS trail. */
export function haversineKm(p1, p2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(p2.lat - p1.lat);
  const dLng = toRad(p2.lng - p1.lng);
  const lat1 = toRad(p1.lat);
  const lat2 = toRad(p2.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
