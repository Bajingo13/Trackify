/* Trackify Driver — service worker.
 *
 * Scoped to /driver so the staff app is never served from a cache.
 *
 * It caches the app shell only. API traffic is deliberately never cached: a
 * driver must not be shown a stale trip list that looks live. When the network
 * is gone the app still opens, and the outbox in IndexedDB is what carries the
 * driver's work until signal returns.
 */
const VERSION = "trackify-driver-v1";
const SHELL = `${VERSION}-shell`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL).then((c) =>
      c.addAll(["/driver", "/driver-manifest.webmanifest", "/driver-icon.svg"]).catch(() => {})
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // never our own origin's API, and never another origin (the API server)
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // navigations: try the network, fall back to the cached shell so the app
  // opens in a dead zone
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put("/driver", copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match("/driver").then((r) => r || Response.error()))
    );
    return;
  }

  // build assets are content-hashed, so a cache hit is always correct
  if (url.pathname.startsWith("/assets/") || /\.(js|css|woff2?|png|svg|webmanifest)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put(request, copy)).catch(() => {});
            return res;
          })
      )
    );
  }
});
