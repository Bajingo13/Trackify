/**
 * Security headers for the web console, set by frontend/server.js.
 *
 * Lives under src/ so the test runner finds its tests. Nothing in the app
 * imports it, so it never reaches the browser bundle — it runs in Node only.
 *
 * The API has sent a full set of headers for a while; the console, which is
 * the half that actually executes JavaScript in somebody's browser, sent only
 * nosniff and a referrer policy. So it could be framed by any page on the
 * internet (clickjacking the approve button), and nothing limited what a
 * script injected into it could load or send.
 *
 * Why the Content-Security-Policy is Report-Only unless told otherwise:
 *
 * A wrong CSP does not fail loudly. It blocks a script, a style, the map's
 * tiles or its web worker, or every call to the API, and the console simply
 * stops working. The origins it has to allow are baked into the build from
 * environment variables — the API host, the tile provider — so a policy
 * written from what the source code says by default can be wrong about what
 * a particular deployment was built with. Report-Only cannot break anything:
 * the browser reports what it WOULD have blocked, those reports land in the
 * server log, and CSP_MODE=enforce turns it on once the log is quiet.
 *
 * Framing protection does not wait for that. X-Frame-Options is enforced from
 * the start, because nothing legitimately frames this console.
 */

/** "https://api.example.com/v1" -> "https://api.example.com" */
export function originOf(value) {
  if (!value) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

/**
 * The origin of a tile URL template such as
 *   https://tile.openstreetmap.org/{z}/{x}/{y}.png
 *   https://{s}.tile.example.org/{z}/{x}/{y}.png
 * A placeholder in the host becomes a wildcard, which CSP allows only as the
 * leftmost label; anything else is refused rather than guessed at.
 */
export function templateOrigin(template) {
  const m = /^(https?):\/\/([^/?#]+)/i.exec(template || "");
  if (!m) return null;
  const host = m[2].replace(/\{[^}]+\}/g, "*");
  if (host.includes("*") && !/^\*\.[^*]+$/.test(host)) return null;
  return `${m[1].toLowerCase()}://${host}`;
}

/** The WebSocket origin the realtime channel uses for an API origin. */
const socketOrigin = (httpOrigin) => httpOrigin.replace(/^http/i, "ws");

/*
 * The defaults the client falls back to when these are unset, repeated here so
 * that an unset variable produces the SAME origin on both sides. If the client
 * default ever changes, this has to change with it — the test pins them.
 */
export const DEFAULT_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

export function buildPolicy(env = process.env) {
  const api = originOf(env.VITE_API_URL);
  const tiles = templateOrigin(env.VITE_MAP_TILE_URL || DEFAULT_TILE_URL);
  const style = originOf(env.VITE_MAP_STYLE_URL);
  const extra = String(env.CSP_CONNECT_SRC || "")
    .split(/[\s,]+/)
    .filter((s) => /^(https?|wss?):\/\/[^\s'";]+$/i.test(s));

  const enforce = String(env.CSP_MODE || "").toLowerCase() === "enforce";

  const connect = [
    "'self'",
    ...(api ? [api, socketOrigin(api)] : []),
    ...(tiles ? [tiles] : []),
    ...(style ? [style] : []),
    ...extra,
  ];

  const directives = {
    "default-src": ["'self'"],
    "script-src": ["'self'"],
    // React, the map and the component styles set styles at runtime. Style
    // injection is a far narrower hole than script injection, and this
    // matches the policy the API itself sends.
    "style-src": ["'self'", "'unsafe-inline'"],
    // data: for receipts and photos fetched through the API, blob: for local
    // previews before upload, the tile host for the map.
    "img-src": ["'self'", "data:", "blob:", ...(tiles ? [tiles] : [])],
    "font-src": ["'self'", "data:"],
    "connect-src": [...new Set(connect)],
    // The map runs its renderer in a worker created from a blob: URL; the
    // Driver App registers /driver-sw.js as a service worker.
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "report-uri": ["/csp-report"],
  };

  // Browsers ignore frame-ancestors in a Report-Only policy and warn about it,
  // so it is only included once the policy is enforced. X-Frame-Options covers
  // framing in both modes.
  if (enforce) directives["frame-ancestors"] = ["'none'"];

  const value = Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(" ")}`)
    .join("; ");

  return {
    enforce,
    header: enforce ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only",
    value,
    directives,
    apiKnown: Boolean(api),
  };
}

/** Every header the console sends, on every response. */
export function securityHeaders(policy) {
  return {
    [policy.header]: policy.value,
    "X-Frame-Options": "DENY",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  };
}

/**
 * One line per violation report, for the server log.
 *
 * The query string is dropped from the page and the blocked address: either
 * can carry a reset token or a search term, and a log is not where those
 * belong.
 */
export function summarizeReport(payload) {
  const report = payload?.["csp-report"] || payload?.body || payload || {};
  const strip = (u) => String(u || "").split("?")[0].split("#")[0].slice(0, 200);
  const directive = report["effective-directive"] || report.effectiveDirective ||
    report["violated-directive"] || report.violatedDirective || "unknown";
  const blocked = strip(report["blocked-uri"] || report.blockedURL || "inline");
  const page = strip(report["document-uri"] || report.documentURL || "");
  return `[csp] ${directive} would block ${blocked || "inline"} on ${page || "an unknown page"}`;
}

/**
 * Reports are sent by browsers, but the endpoint is public, so anybody can post
 * to it. A cap per minute keeps somebody from filling the log with it.
 */
export function createReportLogger({ limitPerMinute = 60, log = console.log, now = Date.now } = {}) {
  let windowStart = now();
  let count = 0;
  let suppressed = 0;
  return function logReport(payload) {
    const t = now();
    if (t - windowStart >= 60_000) {
      if (suppressed) log(`[csp] ${suppressed} further report(s) suppressed in the last minute`);
      windowStart = t;
      count = 0;
      suppressed = 0;
    }
    if (count >= limitPerMinute) {
      suppressed += 1;
      return false;
    }
    count += 1;
    log(summarizeReport(payload));
    return true;
  };
}
