/**
 * A ceiling on how fast one address may read a public page.
 *
 * The customer's tracking link is the only thing in this system that answers
 * without a sign-in, and its credential is a long random token — so the thing
 * to stop is somebody trying tokens in bulk, not a customer refreshing a page.
 * Both fit under a generous per-minute count per address; a guessing run does not.
 *
 * Per-process and deliberately so, like the sign-in throttle: no dependency,
 * nothing to deploy. If this runs on several replicas each holds its own count.
 */
export default function publicRateLimit({ max = 60, windowMs = 60 * 1000, now = () => Date.now() } = {}) {
  const hits = new Map();

  return function limit(req, res, next) {
    const t = now();
    const key = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "unknown";

    // forget addresses that have gone quiet, so the map cannot grow without bound
    if (hits.size > 5000) {
      for (const [k, list] of hits) if (list.every((x) => t - x >= windowMs)) hits.delete(k);
    }

    const live = (hits.get(key) || []).filter((x) => t - x < windowMs);
    if (live.length >= max) {
      const retry = Math.max(1, Math.ceil((windowMs - (t - live[0])) / 1000));
      res.set("Retry-After", String(retry));
      return res.status(429).json({ success: false, message: "Too many requests. Please try again in a moment." });
    }
    live.push(t);
    hits.set(key, live);
    return next();
  };
}
