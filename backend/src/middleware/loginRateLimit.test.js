import "../config/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import loginRateLimit, { resetLoginThrottle } from "./loginRateLimit.js";

/**
 * Throttling repeated failed sign-ins.
 *
 * The limiter judges by the response status rather than asking the controller
 * to report in, so these tests drive it the same way the server does: call the
 * middleware, set a status, then fire the "finish" listener it registered.
 */

/** A response stand-in that lets the test fire the finish event itself. */
function fakeRes() {
  const listeners = [];
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    set(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    on(event, cb) { if (event === "finish") listeners.push(cb); },
    finish(code) { this.statusCode = code; listeners.forEach((cb) => cb()); },
  };
}

const req = (email) => ({ ip: "203.0.113.7", body: { email } });

/**
 * The limiter waives itself under NODE_ENV=test so the suites can sign in
 * freely, so these tests have to run it as a server would.
 */
async function asServer(fn) {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  try {
    return await fn();
  } finally {
    process.env.NODE_ENV = previous;
  }
}

/** Drives n failed sign-ins through the limiter. */
function failTimes(limiter, email, n) {
  for (let i = 0; i < n; i += 1) {
    const res = fakeRes();
    limiter(req(email), res, () => {});
    res.finish(401);
  }
}

test("a run of wrong passwords eventually gets a 429 with a Retry-After", async () => {
  await asServer(() => {
    resetLoginThrottle();
    const limiter = loginRateLimit({ identityFrom: (r) => r.body?.email, maxPerIdentity: 3 });
    failTimes(limiter, "someone@example.com", 3);

    const res = fakeRes();
    let passed = false;
    limiter(req("someone@example.com"), res, () => { passed = true; });

    assert.equal(passed, false, "a blocked attempt must not reach the controller");
    assert.equal(res.statusCode, 429);
    assert.ok(res.headers["Retry-After"], "a client needs to be told how long to wait");
  });
});

test("getting it right clears that account immediately", async () => {
  // Somebody who mistypes twice and then succeeds should never be held back.
  await asServer(() => {
    resetLoginThrottle();
    const limiter = loginRateLimit({ identityFrom: (r) => r.body?.email, maxPerIdentity: 3 });
    failTimes(limiter, "driver@example.com", 2);

    const ok = fakeRes();
    limiter(req("driver@example.com"), ok, () => {});
    ok.finish(200);

    failTimes(limiter, "driver@example.com", 2);
    const res = fakeRes();
    let passed = false;
    limiter(req("driver@example.com"), res, () => { passed = true; });

    assert.equal(passed, true, "the successful sign-in should have cleared the count");
  });
});

test("one identity being locked out does not lock out another", async () => {
  await asServer(() => {
    resetLoginThrottle();
    const limiter = loginRateLimit({ identityFrom: (r) => r.body?.email, maxPerIdentity: 2, maxPerIp: 50 });
    failTimes(limiter, "victim@example.com", 2);

    const res = fakeRes();
    let passed = false;
    limiter(req("other@example.com"), res, () => { passed = true; });

    assert.equal(passed, true);
  });
});

test("resetting clears a lockout, so a second test run starts clean", async () => {
  // This is the whole point of the hook: the end-to-end suite signs in with
  // wrong credentials on purpose, and used to leave the account throttled in
  // server memory for fifteen minutes.
  await asServer(() => {
    resetLoginThrottle();
    const limiter = loginRateLimit({ identityFrom: (r) => r.body?.email, maxPerIdentity: 2 });
    failTimes(limiter, "suite@example.com", 2);

    const blocked = fakeRes();
    limiter(req("suite@example.com"), blocked, () => {});
    assert.equal(blocked.statusCode, 429);

    assert.equal(resetLoginThrottle(), true);

    const after = fakeRes();
    let passed = false;
    limiter(req("suite@example.com"), after, () => { passed = true; });
    assert.equal(passed, true, "the reset should have cleared the lockout");
  });
});

test("the reset refuses to run in production", async () => {
  // Nothing on a deployed server should be able to wipe the record of failed
  // sign-ins. The route is not registered there either; this is the second lock.
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    assert.equal(resetLoginThrottle(), false);
  } finally {
    process.env.NODE_ENV = previous;
  }
});
