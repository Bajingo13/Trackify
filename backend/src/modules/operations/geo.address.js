/**
 * Turning what someone types into a place on the map.
 *
 * The search this replaces asked Nominatim for `addressdetails=0`, so a result
 * came back as a single display string with no street, barangay or house number
 * in it. The picker could not tell "123 Rizal Street, Barangay Poblacion" from
 * "Davao City" — both looked the same and both dropped a pin — which is how a
 * trip ends up routed to the middle of a city and still looks correct.
 *
 * Three things are added here:
 *
 *   • address detail, so the parts of an address exist at all
 *   • a precision rung per result, so a screen can say how exact a match is
 *   • structured search and reverse geocoding, which are the only ways to place
 *     a house that free text cannot reach
 *
 * An honest limit, worth knowing before expecting too much of it: OpenStreetMap
 * coverage in the Philippines is good for roads and barangays in built-up areas
 * and thin for individual house numbers. No amount of query tuning invents data
 * that was never mapped. Dropping a pin and reverse-geocoding it is the
 * reliable way to record an exact door, which is why that path exists.
 *
 * Self-contained on purpose: routing in geo.service.js talks to OSRM and this
 * talks to Nominatim, and the two have different rate limits and failure modes.
 * geo.service.js re-exports these so existing callers keep one geocoder.
 */

const NOMINATIM = (process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org").replace(/\/$/, "");
const UA = "AstreaBlueTrackify/1.0 (fleet ops app)";

const num = (v) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

/** fetch with a hard timeout, so a slow public server cannot hang a request. */
async function fetchT(url, opts = {}, ms = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

/* ---------------------------------------------------------------- */
/* Address precision                                                */
/* ---------------------------------------------------------------- */

/*
 * A barangay is the level a Philippine address turns on, and OpenStreetMap has
 * no field for it. Depending on who mapped the area it arrives as barangay,
 * suburb, village, neighbourhood, quarter or hamlet. All are the same rung.
 */
const BARANGAY_KEYS = ["barangay", "suburb", "village", "neighbourhood", "quarter", "hamlet"];
const CITY_KEYS = ["city", "town", "municipality"];
const PROVINCE_KEYS = ["province", "state", "county"];

const firstOf = (address, keys) => {
  for (const k of keys) if (address?.[k]) return String(address[k]);
  return null;
};

/** house → street → barangay → city → province → area. */
export function precisionOf(address = {}) {
  if (address?.house_number) return "house";
  if (address?.road) return "street";
  if (firstOf(address, BARANGAY_KEYS)) return "barangay";
  if (firstOf(address, CITY_KEYS)) return "city";
  if (firstOf(address, PROVINCE_KEYS)) return "province";
  return "area";
}

/**
 * The address written the way it is written here: house and street, barangay,
 * city or municipality, province.
 *
 * Nominatim's own display_name leads with the country and carries the postal
 * region, which reads as noise to a dispatcher deciding where a truck goes.
 */
export function formatAddress(address = {}) {
  const barangay = firstOf(address, BARANGAY_KEYS);
  const parts = [
    [address?.house_number, address?.road].filter(Boolean).join(" ") || null,
    barangay ? (/^(brgy|barangay)/i.test(barangay) ? barangay : `Barangay ${barangay}`) : null,
    firstOf(address, CITY_KEYS),
    firstOf(address, PROVINCE_KEYS),
  ].filter(Boolean);
  // OSM frequently carries the same name as both city and municipality, and
  // "Digos City, Digos City" makes a correct match look broken.
  return [...new Set(parts)].join(", ");
}

const shape = (x) => {
  const address = x.address || {};
  return {
    label: formatAddress(address) || x.display_name,
    fullLabel: x.display_name,
    lat: Number(x.lat),
    lng: Number(x.lon),
    precision: precisionOf(address),
    address: {
      houseNumber: address.house_number || null,
      street: address.road || null,
      barangay: firstOf(address, BARANGAY_KEYS),
      city: firstOf(address, CITY_KEYS),
      province: firstOf(address, PROVINCE_KEYS),
      postcode: address.postcode || null,
    },
  };
};

/* ---------------------------------------------------------------- */
/* Nominatim, politely                                              */
/* ---------------------------------------------------------------- */

/*
 * Nominatim's usage policy allows roughly one request a second from one source
 * and asks for an identifying User-Agent. Two search boxes typing at once
 * already breaks that, and the penalty is the whole deployment's address being
 * blocked — so calls queue behind one another and repeats are served from
 * memory. A self-hosted instance via NOMINATIM_URL removes the limit entirely.
 */
const MIN_GAP_MS = 1100;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 400;

const cache = new Map();
let lastCall = 0;
let chain = Promise.resolve();

function cached(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function remember(key, value) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Serialises calls and keeps them at least MIN_GAP_MS apart. */
function queued(fn) {
  const run = chain.then(async () => {
    const wait = MIN_GAP_MS - (Date.now() - lastCall);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    return fn();
  });
  // Keep the chain alive even when one call rejects.
  chain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function nominatim(path, params) {
  const url = `${NOMINATIM}${path}?${new URLSearchParams({
    format: "jsonv2",
    addressdetails: "1",
    ...params,
  })}`;

  const hit = cached(url);
  if (hit) return hit;

  return queued(async () => {
    // Another caller may have filled it while this one waited its turn.
    const again = cached(url);
    if (again) return again;
    const r = await fetchT(url, { headers: { "User-Agent": UA, "Accept-Language": "en" } });
    if (!r.ok) return remember(url, []);
    return remember(url, await r.json());
  });
}

/** A ~12km box around a point, as Nominatim wants it: left,top,right,bottom. */
function viewbox(near) {
  const lat = num(near?.lat);
  const lng = num(near?.lng);
  if (lat == null || lng == null) return null;
  const d = 0.11;
  return [lng - d, lat + d, lng + d, lat - d].map((n) => n.toFixed(5)).join(",");
}

/* ---------------------------------------------------------------- */
/* Search                                                           */
/* ---------------------------------------------------------------- */

/**
 * Free-text place search, biased to the Philippines and, when given, to the
 * area being worked in.
 *
 * `near` builds a viewbox around a point. Nominatim treats it as a preference
 * rather than a filter, so a genuine match elsewhere still surfaces — it simply
 * stops a common street name resolving to whichever one in the country happens
 * to rank highest.
 */
export async function geocode(query, { near = null, limit = 8 } = {}) {
  const q = String(query || "").trim();
  if (q.length < 3) return [];

  const params = {
    q,
    limit: String(Math.min(Math.max(Number(limit) || 8, 1), 20)),
    countrycodes: "ph",
  };
  const box = viewbox(near);
  if (box) params.viewbox = box;

  const rows = await nominatim("/search", params);
  return (Array.isArray(rows) ? rows : []).map(shape);
}

/**
 * Structured search — a house number, street, barangay and city in their own
 * fields, which is what a dispatcher is reading off a delivery note.
 *
 * Materially better than pasting the same words into one box: each component is
 * matched against the right level instead of the geocoder guessing where the
 * street ends and the barangay begins. The barangay travels with the city
 * because OpenStreetMap has no barangay parameter of its own.
 */
export async function geocodeStructured({
  houseNumber,
  street,
  barangay,
  city,
  province,
  postcode,
  near,
} = {}) {
  const streetLine = [houseNumber, street].filter(Boolean).join(" ").trim();
  // countrycodes already constrains this; the extra country parameter is
  // redundant and only adds another component that has to match.
  const params = { limit: "8", countrycodes: "ph" };

  if (streetLine) params.street = streetLine;
  // The barangay travels in the city field because OpenStreetMap has no
  // barangay parameter, and measured against Nominatim it narrows correctly:
  // street="Rizal Street" with city="Sasa, Davao City" returns the Rizal Street
  // in Sasa, where city="Davao City" alone returns several across the city.
  if (city) params.city = [barangay, city].filter(Boolean).join(", ");
  else if (barangay) params.city = String(barangay);
  if (province) params.county = String(province);
  if (postcode) params.postalcode = String(postcode);

  if (!params.street && !params.city && !params.county && !params.postalcode) return [];

  const box = viewbox(near);
  if (box) params.viewbox = box;

  const rows = await nominatim("/search", params);
  const hits = (Array.isArray(rows) ? rows : []).map(shape);
  if (hits.length) return hits;

  /*
   * When structured matching found nothing, ask again as free text.
   *
   * Structured search is all-or-nothing: every component must match, so one
   * house number that was never mapped — and most Philippine house numbers
   * were never mapped — returns an empty list even when the street is right
   * there in the data. Free text degrades instead, landing on the street or the
   * barangay, and the precision on each result says which. That is far more
   * useful to a dispatcher than nothing.
   */
  const joined = [streetLine, barangay, city, province].filter(Boolean).join(", ");
  if (!joined) return [];
  return geocode(joined, { near });
}

/**
 * What is at this point.
 *
 * The picker used to label a dropped pin with its own coordinates, so a trip
 * recorded "7.07345, 125.61234" as its origin and nobody downstream could read
 * it. Dropping a pin is the most precise thing a dispatcher can do — it is the
 * only way to place a house OpenStreetMap has never heard of — so it has to
 * come back with an address attached.
 *
 * The caller's own coordinates are kept, not the ones Nominatim snaps to: the
 * dispatcher pointed at a gate, and the nearest mapped building is not it.
 */
export async function reverseGeocode(lat, lng) {
  const a = num(lat);
  const b = num(lng);
  if (a == null || b == null) return null;

  const rows = await nominatim("/reverse", { lat: String(a), lon: String(b), zoom: "18" });
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row || row.error) return null;
  return { ...shape(row), lat: a, lng: b };
}
