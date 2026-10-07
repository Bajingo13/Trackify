/* Trackify staff console — service worker.
 *
 * Keeps the app shell (index.html and the hashed build assets) so a refresh
 * while the network is down opens the console instead of the browser's
 * "No internet" page. From there the console behaves as it does for any
 * dropped connection: OfflineNotice says so and each request explains its own
 * failure.
 *
 * What it deliberately does not do:
 *  - cache the API. Dispatch and tracking data must never be shown stale as if
 *    it were live, so /api/ and every other origin go straight to the network.
 *  - touch /driver. The Driver App has its own worker (/driver-sw.js, scope
 *    /driver), which the browser prefers for those pages.
 *  - serve an old shell when online. Navigations try the network first, so a
 *    new deploy is picked up on the next load.
 */
const VERSION = "trackify-staff-v1";
const SHELL = `${VERSION}-shell`;
const SHELL_URL = "/index.html";
const MAX_ASSETS = 400; // roughly five builds of hashed chunks

function isApi(pathname) {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function isDriver(pathname) {
  return pathname === "/driver" || pathname.startsWith("/driver/");
}

// A page the router owns: no file extension, not the API, not the Driver App.
function isShellNavigation(request, url) {
  if (request.mode !== "navigate") return false;
  if (isApi(url.pathname) || isDriver(url.pathname)) return false;
  if (url.pathname === "/health" || url.pathname === "/csp-report") return false;
  return !/\.[a-z0-9]+$/i.test(url.pathname);
}

async function trim(cache) {
  const keys = await cache.keys();
  const extra = keys.length - MAX_ASSETS;
  for (let i = 0; i < extra; i += 1) await cache.delete(keys[i]);
}

// Best effort: keep the entry chunks index.html names, so the very first
// refresh offline works without having to visit a second time.
async function precache() {
  const cache = await caches.open(SHELL);
  const res = await fetch(SHELL_URL, { cache: "reload" });
  if (!res.ok) return;
  const html = await res.clone().text();
  await cache.put(SHELL_URL, res);
  const assets = [...new Set(html.match(/\/assets\/[^"'\s)]+/g) || [])];
  await Promise.all(assets.map((a) => cache.add(a).catch(() => {})));
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache().catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith("trackify-staff-") && k !== SHELL).map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isApi(url.pathname)) return;

  if (isShellNavigation(request, url)) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const type = res.headers.get("content-type") || "";
          if (res.ok && type.includes("text/html")) {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put(SHELL_URL, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(SHELL_URL).then((r) => r || Response.error()))
    );
    return;
  }

  // hashed build output: a cache hit is always the right file
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches
                .open(SHELL)
                .then((c) => c.put(request, copy).then(() => trim(c)))
                .catch(() => {});
            }
            return res;
          })
      )
    );
  }
});
