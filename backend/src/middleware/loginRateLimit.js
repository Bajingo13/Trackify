/**
 * Throttle repeated failed sign-ins.
 *
 * Driver PINs are four digits — ten thousand combinations. Unlimited attempts
 * turn that into a few minutes of scripted guessing, which was academic while
 * the system only ever ran on a laptop and is not once it has a public URL.
 *
 * Two counters run per endpoint, and only FAILURES count:
 *
 *   • per identity — the email or employee number being guessed at. Stops
 *     someone walking every PIN for one driver.
 *   • per IP       — every identity from one source added together. Stops
 *     someone walking one PIN across every driver instead.
 *
 * A successful sign-in clears that identity immediately, so a person who
 * mistypes twice and then gets it right is never held back. Nothing is stored
 * beyond the window, and both maps are pruned as they are read, so this cannot
 * grow without bound.
 *
 * State is per-process and deliberately so: no dependency, no Redis, nothing to
 * deploy. It resets if the server restarts, which an attacker cannot cause.
 * If this ever runs on more than one replica, each holds its own count and the
 * effective limit multiplies by the replica count — revisit it then.
 */

const WINDOW_MS = 15 * 60 * 1000;

/** Remove attempts that have aged out; returns what is left inside the window. */
function recent(store, key, now) {
  const hits = store.get(key);
  if (!hits) return [];
  const live = hits.filter((t) => now - t < WINDOW_MS);
  if (live.length) store.set(key, live);
  else store.delete(key);
  return live;
}

/** Drop every key whose attempts have all aged out. */
function prune(store, now) {
  for (const [key, hits] of store) {
    if (hits.every((t) => now - t >= WINDOW_MS)) store.delete(key);
  }
}

export default function loginRateLimit({
  identityFrom,
  maxPerIdentity = 5,
  maxPerIp = 20,
} = {}) {
  const byIdentity = new Map();
  const byIp = new Map();
  let lastPrune = 0;

  return function limiter(req, res, next) {
    // The test suite signs in constantly and asserts on 401s of its own.
    if (process.env.NODE_ENV === "test") return next();

    const now = Date.now();
    if (now - lastPrune > WINDOW_MS) {
      prune(byIdentity, now);
      prune(byIp, now);
      lastPrune = now;
    }

    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    const identity = String(identityFrom?.(req) || "").trim().toLowerCase();
    const idKey = identity ? `${ip}|${identity}` : null;

    const idHits = idKey ? recent(byIdentity, idKey, now) : [];
    const ipHits = recent(byIp, ip, now);

    const blocked =
      (idKey && idHits.length >= maxPerIdentity) || ipHits.length >= maxPerIp;

    if (blocked) {
      const oldest = Math.min(...[...idHits, ...ipHits]);
      const retryAfter = Math.max(1, Math.ceil((WINDOW_MS - (now - oldest)) / 1000));
      res.set("Retry-After", String(retryAfter));
      return res.status(429).json({
        success: false,
        message: `Too many failed sign-in attempts. Try again in ${Math.ceil(retryAfter / 60)} minute(s).`,
      });
    }

    // Judge by the outcome rather than asking every controller to report in.
    res.on("finish", () => {
      const failed = res.statusCode === 401;
      const succeeded = res.statusCode >= 200 && res.statusCode < 300;
      const at = Date.now();

      if (failed) {
        if (idKey) byIdentity.set(idKey, [...recent(byIdentity, idKey, at), at]);
        byIp.set(ip, [...recent(byIp, ip, at), at]);
      } else if (succeeded && idKey) {
        byIdentity.delete(idKey);
      }
    });

    next();
  };
}
