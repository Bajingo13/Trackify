import { test } from "node:test";
import assert from "node:assert/strict";
import publicRateLimit from "./publicRateLimit.js";

const reqFrom = (ip) => ({ headers: {}, socket: { remoteAddress: ip } });
const resRecorder = () => {
  const out = { headers: {}, statusCode: 200 };
  out.res = {
    set(k, v) { out.headers[k] = v; return this; },
    status(code) { out.statusCode = code; return this; },
    json(body) { out.body = body; return this; },
  };
  return out;
};

test("an address may read the page freely up to the ceiling, then is asked to wait", () => {
  let clock = 1_000_000;
  const limit = publicRateLimit({ max: 3, windowMs: 60_000, now: () => clock });
  let passed = 0;
  for (let i = 0; i < 3; i += 1) limit(reqFrom("10.0.0.1"), resRecorder().res, () => { passed += 1; });
  assert.equal(passed, 3);

  const blocked = resRecorder();
  let reached = false;
  limit(reqFrom("10.0.0.1"), blocked.res, () => { reached = true; });
  assert.equal(reached, false);
  assert.equal(blocked.statusCode, 429);
  assert.ok(Number(blocked.headers["Retry-After"]) >= 1);
});

test("one address being held back does not hold anyone else, and the window passes", () => {
  let clock = 1_000_000;
  const limit = publicRateLimit({ max: 1, windowMs: 60_000, now: () => clock });
  const next = () => {};
  limit(reqFrom("10.0.0.1"), resRecorder().res, next);

  const other = resRecorder();
  let reached = false;
  limit(reqFrom("10.0.0.2"), other.res, () => { reached = true; });
  assert.equal(reached, true, "a different address is unaffected");

  clock += 61_000;
  let again = false;
  limit(reqFrom("10.0.0.1"), resRecorder().res, () => { again = true; });
  assert.equal(again, true, "the first address may read again once the window has passed");
});

test("the address is the one Express resolved, when there is one", () => {
  const limit = publicRateLimit({ max: 1 });
  const req = { ip: "203.0.113.9", headers: {}, socket: { remoteAddress: "10.0.0.1" } };
  limit(req, resRecorder().res, () => {});
  const second = resRecorder();
  limit(req, second.res, () => {});
  assert.equal(second.statusCode, 429);
});

test("a forged proxy header does not buy a fresh count", () => {
  const limit = publicRateLimit({ max: 1 });
  const forged = (n) => ({ ip: "198.51.100.7", headers: { "x-forwarded-for": `203.0.113.${n}` }, socket: { remoteAddress: "198.51.100.7" } });
  limit(forged(1), resRecorder().res, () => {});
  const second = resRecorder();
  limit(forged(2), second.res, () => {});
  assert.equal(second.statusCode, 429);
});
