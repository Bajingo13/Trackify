/* Trackify Driver — service worker.
 *
 * Scoped to /driver so the staff app is never served from a cache.
 *
 * It caches the app shell only. API traffic is deliberately never cached: a
 * driver must not be shown a stale trip list that looks live. When the network
 * is gone the app still opens, and the outbox in IndexedDB is what carries the
 * driver's work until signal returns.
 */
// Bumped whenever the caching rules change: activation deletes every cache that
// does not start with this, which is what clears a stale stylesheet out.
const VERSION = "trackify-driver-v2";
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

  // Build output in /assets/ is content-hashed, so a cache hit is always correct.
  if (url.pathname.startsWith("/assets/")) {
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
    return;
  }

  // Anything else that keeps its name from one version to the next — icons, the
  // manifest, and every script and stylesheet a dev server serves unhashed —
  // goes to the network first and uses the cache only when there is no signal.
  // Cache-first here is how a screen ends up running new code against an old
  // stylesheet, with half its rules missing.
  if (/\.(js|jsx|ts|tsx|css|woff2?|png|svg|webmanifest)$/.test(url.pathname)) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(request, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(request).then((r) => r || Response.error()))
    );
  }
});

/* Notices from the office: a reply, a pause decided. The text is short on purpose (it shows
 * on a lock screen) and says that something happened, not what was written. Tapping it opens
 * the app, or brings it to the front if it is already open. */
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* a notice with no readable body still says something happened */ }
  event.waitUntil(
    self.registration.showNotification(data.title || "Trackify", {
      body: data.body || "Open Trackify to see it.",
      tag: data.tag || undefined,
      icon: "/driver-icon-192.png",
      badge: "/driver-icon-192.png",
      data: { url: data.url || "/driver" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/driver";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const w of windows) {
        if (new URL(w.url).pathname.startsWith("/driver") && "focus" in w) return w.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
