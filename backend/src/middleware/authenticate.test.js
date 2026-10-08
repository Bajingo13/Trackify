import { test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import authenticate from "./authenticate.js";

/**
 * The staff chain must not be reachable with a Driver App token.
 *
 * Both are signed with the same secret. The only thing keeping a driver out of
 * /api/v1/operations/trips — and so out of every other staff route, including
 * the trip search behind Ctrl+K — is that authenticate() refuses a token marked
 * kind:"driver" or one with no userId. Nothing tested it.
 */

const SECRET = "test-secret-for-authenticate";

function run(headers) {
  const saved = process.env.JWT_SECRET;
  process.env.JWT_SECRET = SECRET;
  const out = { statusCode: null, next: false, body: null };
  const res = { status(c) { out.statusCode = c; return this; }, json(b) { out.body = b; return this; } };
  const req = { headers };
  authenticate(req, res, () => { out.next = true; });
  process.env.JWT_SECRET = saved;
  return { ...out, req };
}
const bearer = (payload, opts) => ({ authorization: `Bearer ${jwt.sign(payload, SECRET, opts)}` });

test("a staff token is accepted and identifies the user", () => {
  const r = run(bearer({ userId: 12, email: "a@b.c" }));
  assert.equal(r.next, true);
  assert.equal(r.req.user.userId, 12);
});

test("a Driver App token is refused on staff routes", () => {
  const r = run(bearer({ kind: "driver", driverId: 4, companyId: 1 }));
  assert.equal(r.statusCode, 401);
  assert.equal(r.next, false);
});

test("a driver token is refused even if it also carries a userId", () => {
  const r = run(bearer({ kind: "driver", userId: 12 }));
  assert.equal(r.statusCode, 401);
  assert.equal(r.next, false);
});

test("a token with no userId is refused", () => {
  assert.equal(run(bearer({ email: "a@b.c" })).statusCode, 401);
});

test("no token, a wrong secret and an expired token are all refused", () => {
  assert.equal(run({}).statusCode, 401);
  const forged = { authorization: `Bearer ${jwt.sign({ userId: 1 }, "someone-elses-secret")}` };
  assert.equal(run(forged).statusCode, 401);
  assert.equal(run(bearer({ userId: 1 }, { expiresIn: -10 })).statusCode, 401);
});
