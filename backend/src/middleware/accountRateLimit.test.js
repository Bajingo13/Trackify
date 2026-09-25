import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import accountRateLimit from "./accountRateLimit.js";

/**
 * A ceiling per staff account. The limit itself was measured — one hurried
 * person made 323 requests a minute — so these test the mechanism, and that it
 * is kept away from the Driver App, whose offline queue drops any 4xx.
 */

function harness(limit) {
  let t = 1_000_000;
  const mw = accountRateLimit({ limit, now: () => t });
  const call = (userId) => {
    const res = { statusCode: 200, headers: {}, body: null, passed: false };
    res.set = (k, v) => { res.headers[k] = v; return res; };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    mw({ user: userId ? { userId } : undefined }, res, () => { res.passed = true; });
    return res;
  };
  return { call, advance: (ms) => { t += ms; } };
}

test("an account under its limit is never slowed", () => {
  const { call } = harness(5);
  for (let i = 0; i < 5; i += 1) assert.equal(call(1).passed, true);
});

test("the request over the limit gets 429, a reason, and when to come back", () => {
  const { call } = harness(3);
  for (let i = 0; i < 3; i += 1) call(1);
  const over = call(1);
  assert.equal(over.passed, false);
  assert.equal(over.statusCode, 429);
  assert.match(over.body.message, /Too many requests from this account/);
  assert.ok(Number(over.headers["Retry-After"]) > 0);
});

test("one account's flood does not spend anybody else's allowance", () => {
  // Keyed by account, not address: an office shares one IP.
  const { call } = harness(2);
  call(1); call(1); call(1);
  assert.equal(call(1).statusCode, 429);
  assert.equal(call(2).passed, true);
});

test("the allowance comes back when the minute is up", () => {
  const { call, advance } = harness(2);
  call(1); call(1);
  assert.equal(call(1).statusCode, 429);
  advance(60_000);
  assert.equal(call(1).passed, true);
});

test("a request with no account is left to authentication to refuse", () => {
  const { call } = harness(1);
  assert.equal(call(undefined).passed, true);
});

test("the default is the measured one", () => {
  // 2,000 a minute: about six times one hurried person's measured peak.
  const saved = process.env.ACCOUNT_RATE_LIMIT;
  delete process.env.ACCOUNT_RATE_LIMIT;
  let t = 0;
  const mw = accountRateLimit({ now: () => t });
  let blocked = 0;
  for (let i = 0; i < 2001; i += 1) {
    const res = { set() { return res; }, status(c) { if (c === 429) blocked += 1; return res; }, json() { return res; } };
    mw({ user: { userId: 7 } }, res, () => {});
  }
  if (saved !== undefined) process.env.ACCOUNT_RATE_LIMIT = saved;
  assert.equal(blocked, 1, "the 2,001st request should be the first refused");
});

test("the Driver App is not behind it", () => {
  /*
   * Its offline queue treats every 4xx as permanent and drops the item. A 429
   * there would silently throw away a driver's expenses and deliveries.
   */
  const routes = fs.readFileSync(new URL("../routes.js", import.meta.url), "utf8");
  const driverLine = routes.split("\n").find((l) => l.includes('"/api/v1/driver"'));
  assert.ok(driverLine, "driver routes not found");
  assert.doesNotMatch(driverLine, /limitAccount|secured/);
  assert.match(routes, /const secured = \[authenticate, limitAccount,/);
});
