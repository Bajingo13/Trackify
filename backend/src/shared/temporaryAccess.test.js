import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { deliverTemporaryPassword, __setMail } from "./temporaryAccess.js";
import { temporaryAccessEmail } from "../modules/auth/auth.emails.js";

/**
 * A temporary password is emailed when it can be and shown when it cannot —
 * never both, and never "emailed" when nothing went out.
 */

afterEach(() => __setMail());

const base = {
  to: "someone@example.test",
  name: "Ana",
  password: "Tfy!abc123",
  expiresAt: new Date("2026-09-28T04:00:00Z"),
};

test("when mail works, the password is emailed and not returned", async () => {
  const sent = [];
  __setMail({ isMailConfigured: () => true, send: async (m) => { sent.push(m); return { sent: true }; } });

  const data = await deliverTemporaryPassword(base);
  assert.deepEqual(data, { delivery: "email" });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "someone@example.test");
  assert.match(sent[0].text, /Tfy!abc123/);
  assert.match(sent[0].html, /Tfy!abc123/);
});

test("when mail is not set up, the password comes back with the reason", async () => {
  let called = false;
  __setMail({ isMailConfigured: () => false, send: async () => { called = true; return { sent: true }; } });

  const data = await deliverTemporaryPassword(base);
  assert.equal(called, false);
  assert.equal(data.delivery, "screen");
  assert.equal(data.temporaryPassword, "Tfy!abc123");
  assert.match(data.deliveryProblem, /not set up/);
});

test("when the send fails, the password comes back instead of being lost", async () => {
  __setMail({ isMailConfigured: () => true, send: async () => ({ sent: false, reason: "535 auth failed at smtp.example" }) });

  const data = await deliverTemporaryPassword(base);
  assert.equal(data.delivery, "screen");
  assert.equal(data.temporaryPassword, "Tfy!abc123");
  // The SMTP error goes to the log, not to the browser.
  assert.doesNotMatch(data.deliveryProblem, /535|smtp/i);
});

test("a send that hangs gives up and falls back to the screen", async () => {
  __setMail({ isMailConfigured: () => true, send: () => new Promise(() => {}) });

  const data = await deliverTemporaryPassword({ ...base, timeoutMs: 20 });
  assert.equal(data.delivery, "screen");
  assert.equal(data.temporaryPassword, "Tfy!abc123");
});

test("the email escapes the name an administrator typed", () => {
  const { html, text } = temporaryAccessEmail({
    name: '<img src=x onerror="alert(1)">',
    password: "Tfy!abc123",
    expires: "9/28/2026, 12:00:00 PM",
    signInUrl: "https://app.example.test/login",
    firstAccount: true,
  });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
  assert.match(text, /An account has been set up for you/);
  assert.match(html, /href="https:\/\/app\.example\.test\/login"/);
});
