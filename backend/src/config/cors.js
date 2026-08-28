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

export const corsOptions = {
  credentials: true,
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowList.has(origin)) return callback(null, true);
    if (process.env.NODE_ENV !== "production" && LOCAL_ORIGIN.test(origin)) {
      return callback(null, true);
    }
    // Not allowed: respond without CORS headers (the browser will block it)
    // rather than throwing a 500.
    return callback(null, false);
  },
};

export default corsOptions;
