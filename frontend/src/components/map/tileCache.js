/**
 * Map tiles kept on the phone, so the driver's map still draws in a dead zone.
 *
 * MapLibre fetches tiles itself and keeps them only in memory, so a reopened
 * app with no signal shows an empty grey map. Wrapping the tile URL in the
 * `cachedtile://` protocol routes every tile through here: Cache Storage first
 * when offline, the network otherwise, and whatever the network returns is
 * kept for next time. A protocol rather than the service worker because the
 * native app may not run one, and this has to work in both.
 *
 * Only the driver's map uses it (MapView's `offlineTiles`). The staff console
 * always goes to the network.
 *
 * OpenStreetMap's tile usage policy forbids bulk downloading, so with the
 * default OSM server the cache holds only tiles the driver has actually seen.
 * prefetchRoute() warms a route's corridor only for a provider of our own
 * (VITE_MAP_TILE_URL set to something that is not tile.openstreetmap.org).
 */

export const PROTOCOL = "cachedtile";
const CACHE = "trackify-tiles-v1";
export const MAX_TILES = 3000;
const TRIM_EVERY = 50; // check the size every this many writes, not on each one

let registered = false;
let writes = 0;

const hasCache = () => typeof caches !== "undefined";
const realUrl = (url) => url.replace(`${PROTOCOL}://`, "");
const osOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;
/*
 * A sharper "offline" from the app that owns the map. The phone's own flag stays
 * up on wifi with no backhaul, and every tile would then wait out a dead request
 * before reaching the copy kept here. The Driver App hands in its netStatus.
 */
let offlineCheck = null;
export function setTileOfflineCheck(fn) {
  offlineCheck = typeof fn === "function" ? fn : null;
}
const offline = () => {
  if (osOffline()) return true;
  try { return Boolean(offlineCheck?.()); } catch { return false; }
};

/* A tile, not a captive portal's login page or a redirect to one. */
const looksLikeTile = (res) =>
  res.ok && !res.redirected && !/text\/html/i.test(res.headers?.get?.("content-type") || "");

async function trim(cache) {
  const keys = await cache.keys();
  const extra = keys.length - MAX_TILES;
  // keys() lists in the order they were stored: the oldest go first
  for (let i = 0; i < extra; i += 1) await cache.delete(keys[i]);
}

async function store(url, res) {
  if (!hasCache() || !looksLikeTile(res)) return;
  try {
    const cache = await caches.open(CACHE);
    await cache.put(url, res);
    writes += 1;
    if (writes % TRIM_EVERY === 0) await trim(cache);
  } catch { /* storage full or blocked: the map still drew from the network */ }
}

async function fromCache(url) {
  if (!hasCache()) return null;
  try {
    return (await (await caches.open(CACHE)).match(url)) || null;
  } catch {
    return null;
  }
}

/** One tile: network first while online, so a provider's update is picked up; the cache otherwise. */
export async function loadTile(url, signal) {
  if (!offline()) {
    try {
      const res = await fetch(url, { signal });
      if (looksLikeTile(res)) {
        void store(url, res.clone());
        return res.arrayBuffer();
      }
    } catch (e) {
      if (e?.name === "AbortError") throw e; // the map no longer wants it
    }
  }
  const kept = await fromCache(url);
  if (kept) return kept.arrayBuffer();
  throw new Error("Tile not available offline");
}

/** Make `cachedtile://<real url>` work. Safe to call more than once. */
export function registerTileCache(maplibregl) {
  if (registered || typeof maplibregl?.addProtocol !== "function") return;
  registered = true;
  maplibregl.addProtocol(PROTOCOL, async (params, abortController) => ({
    data: await loadTile(realUrl(params.url), abortController?.signal),
  }));
}

/** The tile template to give MapLibre when this map should work offline. */
export const cachedTemplate = (template) => `${PROTOCOL}://${template}`;

/* ---- warming a route's corridor before the dead zone ---- */

/**
 * The raster tile template MapView draws with, or null when a
 * VITE_MAP_STYLE_URL style brings its own sources. Read here rather than from
 * MapView so the trip screen can warm a route without loading MapLibre.
 */
export const routeTileTemplate = () =>
  import.meta.env.VITE_MAP_STYLE_URL
    ? null
    : import.meta.env.VITE_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

/** Whether bulk prefetching is allowed for this tile server (never for OSM's own). */
export const mayPrefetch = (template) => !/(^|\.)tile\.openstreetmap\.org\//i.test(String(template).replace(/^https?:\/\//, ""));

function tileOf(lng, lat, z) {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const rad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  return { x: Math.min(Math.max(x, 0), n - 1), y: Math.min(Math.max(y, 0), n - 1) };
}

/**
 * The tiles along a route at zooms `zooms`, with one tile either side.
 * `coords` is a GeoJSON LineString's [[lng, lat], ...].
 */
export function corridorTiles(coords, zooms = [10, 12, 14], limit = 1500) {
  const out = new Set();
  for (const z of zooms) {
    for (const [lng, lat] of coords) {
      const { x, y } = tileOf(lng, lat, z);
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) out.add(`${z}/${x + dx}/${y + dy}`);
      }
      if (out.size >= limit) return [...out];
    }
  }
  return [...out];
}

const prefetched = new Set();

/**
 * Keep a route's corridor on the phone, a few tiles at a time, once per route
 * per session. Does nothing for OSM's server, offline, or without Cache Storage.
 */
export async function prefetchRoute(template, coords, key) {
  if (!template || !hasCache() || offline() || !mayPrefetch(template) || !Array.isArray(coords) || coords.length === 0) return 0;
  if (key != null && prefetched.has(key)) return 0;
  if (key != null) prefetched.add(key);
  const cache = await caches.open(CACHE);
  let fetched = 0;
  for (const t of corridorTiles(coords)) {
    if (offline()) break;
    const [z, x, y] = t.split("/");
    const url = template.replace("{z}", z).replace("{x}", x).replace("{y}", y);
    if (await cache.match(url)) continue;
    try {
      const res = await fetch(url);
      if (looksLikeTile(res)) { await store(url, res); fetched += 1; }
    } catch { break; } // the signal went: stop, and try again next session
  }
  return fetched;
}
