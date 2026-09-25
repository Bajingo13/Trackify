import "../config/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { passwordChangeGuard } from "./requirePasswordChangeComplete.js";

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("a temporary-password account cannot reach business routes", async () => {
  const runner = { execute: async () => [[{ must_change_password: 1 }]] };
  const res = response();
  let continued = false;
  await passwordChangeGuard(runner)({ user: { userId: 7 } }, res, () => { continued = true; });
  assert.equal(continued, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, "PASSWORD_CHANGE_REQUIRED");
});

test("the live database flag overrides an older unrestricted token", async () => {
  const runner = { execute: async () => [[{ must_change_password: 1 }]] };
  const res = response();
  await passwordChangeGuard(runner)({ user: { userId: 7, mustChangePassword: false } }, res, () => {});
  assert.equal(res.statusCode, 403);
});

test("an activated account continues to the requested route", async () => {
  const runner = { execute: async () => [[{ must_change_password: 0 }]] };
  let continued = false;
  await passwordChangeGuard(runner)({ user: { userId: 7, mustChangePassword: false } }, response(), () => { continued = true; });
  assert.equal(continued, true);
});
