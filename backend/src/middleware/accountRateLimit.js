/**
 * A ceiling on how many requests one staff account can make in a minute.
 *
 * What this is: a backstop against a runaway client or a stolen token being
 * used to hammer the API — a script in a tight loop, a page stuck re-fetching.
 * What it is not: a defence against somebody patiently scraping under the
 * limit. That needs different measures.
 *
 * The number was measured, not guessed. Driving the real console through its
 * busiest screens as fast as a hurried dispatcher would — full page loads,
 * polling dashboards, live tracking left open — one person made 323 requests
 * in a minute, with bursts of 197 in ten seconds, because every page load
 * re-fetches the alert endpoints. A limit that sounded sensible, like 300, would
 * have locked that person out. 2,000 is about six times the measured peak and
 * leaves room for several tabs.
 *
 * Keyed by account, not by address: an office shares one IP, and counting by
 * address would make colleagues use up each other's allowance.
 *
 * Deliberately NOT applied to the Driver App. Its offline queue drops any 4xx
 * and a 429 is a 4xx, so a limit there would silently discard a driver's
 * expenses and deliveries rather than slow them down.
 *
 * Per process, like the sign-in throttle: with more than one replica each
 * keeps its own count and the effective ceiling multiplies.
 */

const WINDOW_MS = 60_000;

export default function accountRateLimit({
  limit = Number(process.env.ACCOUNT_RATE_LIMIT) || 2000,
  now = Date.now,
} = {}) {
  const counters = new Map(); // userId -> { windowStart, count }
  let lastPrune = now();

  return function limitAccount(req, res, next) {
    const key = req.user?.userId;
    if (!key) return next(); // authenticate has already refused anyone without one

    const t = now();

    // Forget accounts whose window has passed, so the map cannot grow without
    // bound across a long-running process.
    if (t - lastPrune >= WINDOW_MS) {
      for (const [k, c] of counters) if (t - c.windowStart >= WINDOW_MS) counters.delete(k);
      lastPrune = t;
    }

    let counter = counters.get(key);
    if (!counter || t - counter.windowStart >= WINDOW_MS) {
      counter = { windowStart: t, count: 0 };
      counters.set(key, counter);
    }
    counter.count += 1;

    if (counter.count > limit) {
      const retryAfter = Math.max(1, Math.ceil((counter.windowStart + WINDOW_MS - t) / 1000));
      res.set("Retry-After", String(retryAfter));
      return res.status(429).json({
        success: false,
        message: `Too many requests from this account. Wait ${retryAfter} second${retryAfter === 1 ? "" : "s"} and try again.`,
      });
    }
    return next();
  };
}
