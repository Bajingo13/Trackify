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

import { findPlusCode, recoverPlusCode } from "./plusCode.js";

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
export function formatAddress(address = {}, name = null) {
  const barangay = firstOf(address, BARANGAY_KEYS);
  const parts = [
    /*
     * The name of the place, when it has one, because it is usually the thing
     * that was searched for.
     *
     * Measured: "Villa, Batangas" returns places named "Villa Santo Niño",
     * "Nueva Villa" and "Twin Villa Subdivision", but their address components
     * carry only the street and town — so a dispatcher who searched "Villa" was
     * handed a list with no "Villa" anywhere in it, which reads as the wrong
     * results rather than the right ones badly labelled.
     */
    name || null,
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
    // The name sits at the top of the row, not inside its address.
    label: formatAddress(address, x.name) || x.display_name,
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
  /*
   * Spaces go as %20 rather than the "+" URLSearchParams emits.
   *
   * Honesty about what this does and does not fix: I first wrote here that "+"
   * was corrupting every multi-word search, having measured a large difference
   * between the two forms. That measurement was made with PowerShell, and it
   * did not reproduce. Asked from node, which is what actually runs, all four
   * combinations of encoded or literal comma with "+" or %20 return exactly the
   * same results. The encoding is not the difference.
   *
   * It is kept because %20 is the unambiguous form in a URL path or query —
   * "+" only means a space by the form-encoding convention — and because a
   * self-hosted Nominatim behind a different proxy may not be as forgiving. It
   * is not load-bearing, and nothing should be built on the belief that it is.
   */
  const query = new URLSearchParams({
    format: "jsonv2",
    addressdetails: "1",
    ...params,
  })
    .toString()
    .replace(/\+/g, "%20");
  const url = `${NOMINATIM}${path}?${query}`;

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

/* ---------------------------------------------------------------- */
/* When the address as typed is not in the map                      */
/* ---------------------------------------------------------------- */

/*
 * Most Philippine addresses a dispatcher types are not in OpenStreetMap, and
 * a strict search answers that with silence. Measured against the real thing,
 * with two addresses off an actual delivery note:
 *
 *   "0394 villa esperanza phase 2, Balayan Batangas"  → nothing
 *   "villa esperanza Batangas"                        → nothing (not mapped
 *                                                       under any form)
 *   "Balayan Batangas"                                → the municipality
 *
 *   "de joya avenue alingilan batangas city"          → nothing
 *   "de joya alingilan batangas city"                 → nothing
 *   "de joya batangas city"                           → De Joya Compound,
 *                                                       Alangilan, Batangas City
 *
 * Two different lessons. The subdivision genuinely does not exist in the data,
 * so the honest best answer is the municipality with the precision said out
 * loud. But "De Joya" is there — one misspelled word in the middle
 * ("alingilan" for Alangilan) was enough to return nothing at all, and dropping
 * it finds the place. A ladder that gives up one component at a time rescues
 * the second case and degrades the first gracefully instead of failing both.
 */

const LEADING_NUMBER = /^\s*#?\d[\d\-/]*\s+/;

/*
 * Words that appear in an address as written but rarely in the name
 * OpenStreetMap holds. "de joya avenue" returns nothing; "de joya" does not.
 */
const NOISE_WORDS =
  /\b(phase|blk|block|lot|unit|rm|room|bldg|building|subd|subdivision|compound|cor|corner|street|ave|avenue|road|highway|hwy)\b\.?/gi;

const tidy = (s) =>
  String(s || "")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/^[,\s]+|[,\s]+$/g, "")
    .trim();

/**
 * The queries to try, most specific first, for an address typed as one line.
 *
 * Pure and exported so it can be tested without touching the network — the
 * measurements above are what the test asserts against.
 */
export function addressLadder(text, { context = null } = {}) {
  const raw = tidy(text);
  if (raw.length < 3) return [];

  const out = [];
  const add = (candidate) => {
    const value = tidy(candidate);
    if (value.length >= 3 && !out.includes(value)) out.push(value);
  };

  /*
   * Ask within the area already being worked in, first.
   *
   * Measured with an origin pin already placed in Balayan: "Villa" returns
   * Northern Samar (415km), Masbate (429km), Aurora (205km), Cagayan (495km)
   * and Southern Leyte (626km) — not one of them in Batangas. The same word
   * with the province appended, "Villa, Batangas", returns Nueva Villa in
   * Alangilan and Twin Villa Subdivision; with the municipality, "Villa,
   * Balayan, Batangas", it returns the Villa resorts on the Balayan-Lemery
   * road. A dispatcher who has already placed one end of the trip means the
   * nearby one, and said so by placing it.
   *
   * Not Nominatim's `bounded` parameter, which was measured too: it restricts
   * to the box but stops matching the words, answering "Villa" with "Cahil,
   * Calaca" and "Balimbing, Calaca". Near and irrelevant is worse than far and
   * right, because it looks like an answer.
   *
   * Only when the text does not already say it, and never instead of the raw
   * query — that still follows, so a long haul to another province is found
   * once the local guess comes back empty.
   */
  const scope = tidy(context);
  if (scope && !raw.toLowerCase().includes(scope.toLowerCase())) add(`${raw}, ${scope}`);

  add(raw);

  // A house or lot number nobody mapped is the single commonest reason a
  // correct street returns nothing.
  const noNumber = raw.replace(LEADING_NUMBER, "");
  add(noNumber);
  add(noNumber.replace(NOISE_WORDS, " "));

  // Give up the most specific part first: "A, B, C" → "B, C" → "C".
  const segments = raw.split(",").map((s) => s.trim()).filter(Boolean);
  for (let i = 1; i < segments.length; i += 1) add(segments.slice(i).join(", "));

  /*
   * Keep the place name and the widest thing named, dropping whatever sits
   * between. This is what rescues a misspelled barangay: "de joya alingilan
   * batangas city" finds nothing, "de joya batangas city" finds De Joya
   * Compound.
   */
  const words = noNumber.replace(NOISE_WORDS, " ").replace(/,/g, " ").split(/\s+/).filter(Boolean);
  if (words.length >= 4) add([words[0], words[1], words[words.length - 2], words[words.length - 1]].join(" "));
  if (words.length >= 3) add([words[0], words[1], words[words.length - 1]].join(" "));

  if (segments.length > 1) add(segments[segments.length - 1]);

  return out;
}

/**
 * Search for an address, giving up one component at a time until something is
 * found.
 *
 * Returns what matched as well as the results, because a dispatcher who typed a
 * house number needs to be told that the pin is the municipality — a silently
 * coarser answer is worse than none. `degraded` is true whenever the thing that
 * matched is not the thing that was typed.
 *
 * Capped at four attempts: calls to Nominatim are serialised 1.1s apart by
 * policy, so an unbounded ladder would take longer than anyone will wait.
 */
export async function geocodeBest(query, { near = null, limit = 8, maxAttempts = 4, context = null } = {}) {
  const typed = tidy(query);

  /*
   * A Plus Code is not a name to be looked up — it is the coordinates, written
   * down. Decoding it is arithmetic, so this is the one case where an address
   * nobody has ever mapped still produces an exact pin.
   *
   * Verified against the real world: "Q3HC+P3F, Alangilan, Batangas City"
   * recovers to 13.779312, 121.070172, and asking what is there returns
   * "De Joya Avenue, De Joya Compound, Alangilan, Dalig, Batangas City".
   */
  const plus = findPlusCode(typed);
  if (plus) {
    const exact = await resolvePlusCode(plus, { near, context });
    if (exact) {
      return { results: [exact], matchedQuery: plus.code, degraded: false, tried: [plus.code] };
    }
  }

  const ladder = addressLadder(query, { context }).slice(0, maxAttempts);
  if (!ladder.length) return { results: [], matchedQuery: null, degraded: false, tried: [] };

  /*
   * The scoped rung is asked without the viewbox.
   *
   * Measured both ways: "Villa, Batangas" returns four real Batangas places on
   * its own, and exactly one unrelated resort when the box around the origin is
   * sent with it. Naming the province is already the narrowing; adding a 12km
   * box on top of it throws away the results that narrowing found. `near` is
   * still used afterwards to sort by distance, which needs no viewbox.
   */
  const scopedRung = ladder[0] !== typed ? ladder[0] : null;

  const tried = [];
  for (const candidate of ladder) {
    tried.push(candidate);
    // eslint-disable-next-line no-await-in-loop
    const results = await geocode(candidate, { near: candidate === scopedRung ? null : near, limit });

    /*
     * A scoped rung only counts if the answer is actually in the scope.
     *
     * Nominatim answers "Villa, Batangas" inconsistently: sometimes with eight
     * subdivisions named Villa in Batangas, sometimes by ignoring "Villa"
     * entirely and returning whatever matches the province word — a proposed
     * expressway in *Cavite*, a rail line. Both measured on fresh, uncached
     * responses to the identical URL, so it is the service, not the request.
     *
     * Without this check the junk answer is still an answer, and stopping on it
     * hides the better rung underneath. Asking for Batangas and being handed
     * Cavite is not a near miss; it is a different question.
     */
    const kept =
      candidate === scopedRung
        ? mentionsAnyTerm(withinScope(results, context), typed)
        : results;

    if (kept.length) {
      return {
        results: withDistance(kept, near),
        matchedQuery: candidate,
        // Measured against what was actually typed, not against the first rung:
        // the first rung may be the scoped guess, which nobody typed.
        degraded: candidate !== typed,
        tried,
      };
    }
  }
  return { results: [], matchedQuery: null, degraded: false, tried };
}

/**
 * Keep only the results that answer the words the user actually typed.
 *
 * The scoped rung is the user's own text with a province appended by us. When
 * Nominatim ignores their words and matches only the province, it returns
 * things that are in the right place and have nothing to do with the question:
 * searching "Villa" with an origin in Batangas produced "PNR Batangas Line",
 * a railway. It contains the word we added and not the word they typed.
 *
 * Returning it is worse than returning nothing, because the ladder stops at the
 * first rung with any results — so the junk hides the plain search underneath,
 * which does find places actually named Villa.
 *
 * Applied to the scoped rung alone. The lower rungs are deliberate
 * degradations: "0394 villa esperanza phase 2" falling back to "Balayan,
 * Batangas" matches none of those words on purpose, and the screen says so.
 */
export function mentionsAnyTerm(results, typedText) {
  const words = tidy(typedText)
    .toLowerCase()
    .replace(NOISE_WORDS, " ")
    .split(/[^a-z0-9ñ]+/i)
    // A bare number is not something to judge a match by: house numbers are
    // rarely mapped, so requiring "0394" to appear would reject the street it
    // sits on. Short fragments are no better.
    .filter((word) => word.length >= 3 && !/^\d+$/.test(word));

  // Nothing distinctive enough to judge by — a house number, two initials —
  // is not grounds for throwing an answer away.
  if (!words.length) return results;

  return results.filter((r) => {
    const label = String(r.label || "").toLowerCase();
    return words.some((word) => label.includes(word));
  });
}

/**
 * Keep only the results that are actually in the place we asked about.
 *
 * Judged on the structured address — the province and the city — and never on
 * the label. "Cavite–Batangas Expressway" carries the word Batangas in its
 * name while sitting in Cavite, and matching on the label would let exactly the
 * result this exists to reject straight through.
 *
 * A result genuinely inside the province is kept even when it is an odd thing
 * to suggest: this enforces where, not relevance. Ranking is Nominatim's job
 * and it is better at it than a filter would be.
 */
export function withinScope(results, scope) {
  const want = tidy(scope).toLowerCase();
  if (!want) return results;
  return results.filter((r) => {
    const where = [r.address?.province, r.address?.city]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    // Nothing to judge by is not evidence of being elsewhere.
    return where === "" || where.includes(want);
  });
}

/**
 * Turn a Plus Code into a point.
 *
 * A short code ("Q3HC+P3F") omits the leading characters covering a one-degree
 * square, so it only means something near somewhere. The rest of what was typed
 * supplies that somewhere — "Alangilan, Batangas City" beside the code is not
 * decoration, it is the reference the code is relative to. Failing that, the
 * point already placed on the map, or the area being worked in.
 *
 * The decoded point is exact to a few metres, so it is reported as `house`
 * regardless of what happens to be mapped around it: nothing else a dispatcher
 * can type is this precise.
 */
async function resolvePlusCode(plus, { near = null, context = null } = {}) {
  let reference = null;

  if (plus.short) {
    if (num(near?.lat) != null && num(near?.lng) != null) {
      reference = { lat: num(near.lat), lng: num(near.lng) };
    } else {
      const hint = [plus.rest, context].filter(Boolean).join(", ");
      if (!hint) return null;
      const [found] = await geocode(hint, { limit: 1 });
      if (!found) return null;
      reference = { lat: found.lat, lng: found.lng };
    }
  }

  const point = recoverPlusCode(plus.code, reference?.lat, reference?.lng);
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return null;

  // Ask what is there, so the pin carries a name a person can read rather than
  // a pair of numbers. Its own coordinates are kept: the code is exact and the
  // nearest mapped thing is not it.
  const described = await reverseGeocode(point.lat, point.lng);
  return {
    label: described?.label || plus.rest || plus.code,
    fullLabel: described?.fullLabel || plus.code,
    lat: point.lat,
    lng: point.lng,
    precision: "house",
    plusCode: plus.code,
    address: described?.address || {},
  };
}

/**
 * How far each result is from the point already placed.
 *
 * A dispatcher cannot tell that "Barangay Villa, Lavezares, Northern Samar" is
 * 415km from the origin they just set — the name alone reads like any other
 * suggestion. The number is what makes an absurd match obviously absurd, and it
 * costs nothing to carry.
 */
function withDistance(results, near) {
  const lat = num(near?.lat);
  const lng = num(near?.lng);
  if (lat == null || lng == null) return results;
  /*
   * Annotated, not reordered.
   *
   * Nominatim's own order is by relevance, and measured on a correctly encoded
   * query it is very good: "Villa, Batangas" comes back as eight subdivisions
   * named Villa, best first. Sorting those by distance throws that judgement
   * away and promotes whatever is nearest — a road 33km off ahead of the
   * subdivision actually named Villa at 45km. The distance is worth showing;
   * it is not worth ranking by.
   */
  return results.map((r) => ({
    ...r,
    distanceKm: Math.round(haversineKm(lat, lng, r.lat, r.lng)),
  }));
}

/* Kept local rather than imported from geo.service.js, which re-exports this
 * module — importing it back would close a cycle for one formula. */
function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
