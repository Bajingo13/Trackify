import "../../config/env.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import bcrypt from "bcrypt";

/**
 * The reset flow, against the real database.
 *
 * This is the only part of the system a stranger can reach, and the failure
 * modes are not "it returned 500" — they are a link that still works after it
 * has been used, a token sitting in the database in plain text, or a reply
 * that quietly tells a stranger which email addresses belong to staff.
 *
 * A temporary account is created and removed again; nothing is ever sent,
 * because the transport is replaced with one that collects messages.
 */

/* Set before the mailer is imported — it reads its configuration once. */
process.env.SMTP_HOST = "smtp.example.test";
process.env.SMTP_USER = "robot@example.test";
process.env.SMTP_PASSWORD = "not-a-real-password";
process.env.MAIL_FROM = "Trackify <robot@example.test>";
process.env.FRONTEND_URL = "https://trackify.example";

const { default: db } = await import("../../config/db.js");
const mailer = await import("../../shared/mailer.js");
const {
  requestPasswordReset, checkResetToken, completePasswordReset, RESET_MINUTES,
} = await import("./passwordReset.controller.js");

const sent = [];
mailer.__setTransport({
  sendMail: async (message) => {
    sent.push(message);
    return { messageId: `test-${sent.length}` };
  },
});

/* Held across tests: after a reset, the newest email is the confirmation,
 * which carries no link — so the token has to be kept before it is spent. */
let spentToken;

const EMAIL = `reset-probe-${crypto.randomUUID().slice(0, 8)}@example.test`;
const ORIGINAL = "the original passphrase";
let userId;

before(async () => {
  const [result] = await db.execute(
    `INSERT INTO users (email, password_hash, first_name, last_name, status)
     VALUES (?, ?, 'Reset', 'Probe', 'active')`,
    [EMAIL, await bcrypt.hash(ORIGINAL, 10)]
  );
  userId = result.insertId;
});

after(async () => {
  await db.execute("DELETE FROM password_reset_tokens WHERE user_id = ?", [userId]);
  await db.execute("DELETE FROM audit_logs WHERE user_id = ? OR entity_id = ?", [userId, String(userId)]);
  await db.execute("DELETE FROM users WHERE user_id = ?", [userId]);
  await db.end();
});

const reqFor = (body = {}, query = {}) => ({
  body, query, params: {},
  headers: {}, socket: { remoteAddress: "203.0.113.9" },
  user: null, context: {},
});

const resFor = () => {
  const res = { statusCode: 200, payload: null };
  res.status = (c) => ((res.statusCode = c), res);
  res.json = (p) => ((res.payload = p), res);
  return res;
};

/** The token as it was emailed — the only place the plain value exists. */
const tokenFromLastEmail = () => {
  const match = /token=([A-Za-z0-9_-]+)/.exec(sent.at(-1)?.text || "");
  return match?.[1];
};

const liveTokens = async () => {
  const [rows] = await db.execute(
    "SELECT token_hash, used_at, expires_at FROM password_reset_tokens WHERE user_id = ?",
    [userId]
  );
  return rows;
};

test("an address with no account gets the same answer as one that has", async () => {
  /*
   * The whole point. A different reply for an unknown address turns this page
   * into a way to find out who works here, one guess at a time.
   */
  const before = sent.length;
  const unknown = resFor();
  await requestPasswordReset(reqFor({ email: "nobody-at-all@example.test" }), unknown);

  const known = resFor();
  await requestPasswordReset(reqFor({ email: EMAIL }), known);

  assert.equal(unknown.statusCode, known.statusCode);
  assert.equal(unknown.payload.message, known.payload.message);
  assert.equal(sent.length, before + 1, "an email went to an address with no account");
});

test("the emailed link points at the reset screen and carries a token", async () => {
  const email = sent.at(-1);
  assert.equal(email.to, EMAIL);
  assert.match(email.text, /https:\/\/trackify\.example\/reset-password\?token=/);
  assert.match(email.html, /https:\/\/trackify\.example\/reset-password\?token=/);
  assert.match(email.text, new RegExp(`${RESET_MINUTES} minutes`));
  assert.ok(tokenFromLastEmail()?.length >= 32, "the token is too short to be random enough");
});

test("what is stored is a hash, not the link somebody could use", async () => {
  // A database dump, a backup, or a read through some unrelated hole must not
  // hand over working keys to accounts.
  const token = tokenFromLastEmail();
  const rows = await liveTokens();

  assert.ok(rows.length >= 1);
  for (const row of rows) {
    assert.notEqual(row.token_hash, token);
    assert.match(row.token_hash, /^[a-f0-9]{64}$/);
  }
  const expected = crypto.createHash("sha256").update(token).digest("hex");
  assert.ok(rows.some((r) => r.token_hash === expected), "the stored hash is not this token's");
});

test("asking again retires the link already in somebody's inbox", async () => {
  /*
   * Otherwise pressing "send it again" three times leaves three working keys
   * in three emails, each good for an hour.
   */
  const first = tokenFromLastEmail();
  await requestPasswordReset(reqFor({ email: EMAIL }), resFor());
  const second = tokenFromLastEmail();
  assert.notEqual(first, second);

  const res = resFor();
  await checkResetToken(reqFor({}, { token: first }), res);
  assert.equal(res.statusCode, 410, "the older link still worked");

  const live = resFor();
  await checkResetToken(reqFor({}, { token: second }), live);
  assert.equal(live.statusCode, 200);
});

test("the check shows enough to recognise the account, not the whole address", async () => {
  const res = resFor();
  await checkResetToken(reqFor({}, { token: tokenFromLastEmail() }), res);

  assert.match(res.payload.data.email, /^r•••@example\.test$/);
  assert.notEqual(res.payload.data.email, EMAIL);
});

test("a password the rules refuse does not burn the link", async () => {
  // Sending somebody back to the start for a fixable typo, when the link is
  // the only way in, is a cruelty a reset screen cannot afford.
  const token = tokenFromLastEmail();
  const res = resFor();
  await completePasswordReset(reqFor({ token, newPassword: "short" }), res);
  assert.equal(res.statusCode, 400);

  const still = resFor();
  await checkResetToken(reqFor({}, { token }), still);
  assert.equal(still.statusCode, 200, "a refused password consumed the link");
});

test("a good password is set, and it is the one the person typed", async () => {
  const token = tokenFromLastEmail();
  spentToken = token;
  const res = resFor();
  await completePasswordReset(reqFor({ token, newPassword: "a whole new passphrase" }), res);

  assert.equal(res.statusCode, 200);
  const [[user]] = await db.execute("SELECT password_hash FROM users WHERE user_id = ?", [userId]);
  assert.equal(await bcrypt.compare("a whole new passphrase", user.password_hash), true);
  assert.equal(await bcrypt.compare(ORIGINAL, user.password_hash), false);
});

test("the confirmation says when and how, because that is what catches a theft", async () => {
  // If the link reached the wrong person, this arriving is how the right one
  // finds out.
  const confirmation = sent.at(-1);
  assert.equal(confirmation.to, EMAIL);
  assert.match(confirmation.subject, /password was changed/i);
  assert.match(confirmation.text, /using a reset link/);
  assert.match(confirmation.text, /203\.0\.113\.9/);
  assert.match(confirmation.text, /tell your administrator/i);
});

test("the used link, and every other one, stops working", async () => {
  const res = resFor();
  await completePasswordReset(
    reqFor({ token: spentToken, newPassword: "yet another passphrase" }),
    res
  );
  assert.equal(res.statusCode, 410, "a used link could be used a second time");

  const rows = await liveTokens();
  assert.ok(rows.every((r) => r.used_at !== null), "a link was left live after a reset");
});

test("a deactivated account gets no link at all", async () => {
  /*
   * Somebody switched off is switched off. The reply is still the neutral one
   * — saying "that account is deactivated" would confirm it exists.
   */
  await db.execute("UPDATE users SET status = 'inactive' WHERE user_id = ?", [userId]);
  const before = sent.length;
  const res = resFor();
  await requestPasswordReset(reqFor({ email: EMAIL }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(sent.length, before, "a deactivated account was emailed a way back in");
  await db.execute("UPDATE users SET status = 'active' WHERE user_id = ?", [userId]);
});

test("every request is recorded, including the ones that matched nothing", async () => {
  // A run of requests for addresses that do not exist is somebody probing,
  // and that is only visible if the misses are logged too.
  const [rows] = await db.execute(
    "SELECT summary FROM audit_logs WHERE action = 'password.reset.request' ORDER BY audit_id DESC LIMIT 20"
  );
  assert.ok(rows.some((r) => /no account/.test(r.summary)), "a miss was not recorded");
  assert.ok(rows.some((r) => new RegExp(EMAIL).test(r.summary)), "a hit was not recorded");
});
