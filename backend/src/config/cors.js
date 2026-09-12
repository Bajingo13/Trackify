/*
 * CORS policy.
 *
 * - Explicit allow-list from CORS_ORIGINS (comma-separated) or FRONTEND_URL.
 * - Outside production, any localhost / 127.0.0.1 / private-LAN origin is also
 *   allowed, so the Vite dev server works whether you open it as
 *   http://localhost:8443, http://127.0.0.1:8443 or http://<your-lan-ip>:8443.
 * - Requests with no Origin header (curl, Postman, health checks) are allowed.
 */
const configured = (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const allowList = new Set(
  configured.length ? configured : ["http://localhost:8443", "http://127.0.0.1:8443"]
);

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+)(:\d+)?$/;

/*
 * The native driver app, which is not a website and has no host of its own.
 * Capacitor serves it out of the app container and the webview presents these
 * origins — `https://localhost` on Android (androidScheme: 'https', pinned in
 * driver-app/capacitor.config.ts) and `capacitor://localhost` on iOS. They are
 * exact strings with no port, so they do not widen LOCAL_ORIGIN, and they have
 * to be allowed in production too: that is where the app actually runs.
 *
 * Worth being clear about what this does and does not concede. A page served
 * from a web server running on someone's own machine could also present
 * `https://localhost` — but it still cannot read a response without a driver's
 * PIN or a valid bearer token, because CORS is not what authenticates these
 * routes. Without this, the app gets no CORS headers at all and every request
 * fails as "Failed to fetch", which says nothing about the cause.
 */
const NATIVE_APP_ORIGINS = new Set([
  "https://localhost",
  "capacitor://localhost",
]);

export const corsOptions = {
  credentials: true,
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowList.has(origin)) return callback(null, true);
    if (NATIVE_APP_ORIGINS.has(origin)) return callback(null, true);
    if (process.env.NODE_ENV !== "production" && LOCAL_ORIGIN.test(origin)) {
      return callback(null, true);
    }
    // Not allowed: respond without CORS headers (the browser will block it)
    // rather than throwing a 500.
    return callback(null, false);
  },
};

export default corsOptions;
