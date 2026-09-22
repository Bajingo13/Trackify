import "../../config/env.js";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import db from "../../config/db.js";
import { updateMyProfile, changeMyPassword } from "./account.controller.js";
import { passwordProblem, MAX_PASSWORD_BYTES } from "../../shared/passwordPolicy.js";

/**
 * Changing your own account.
 *
 * The cases that matter are the ones where being wrong hands somebody an
 * account: a password changed without proving you know the old one, an email
 * address moved by a borrowed session, or a password that is silently not the
 * password the person typed.
 */

const realExecute = db.execute.bind(db);
after(async () => {
  db.execute = realExecute;
  await db.end();
});

const PASSWORD = "correct horse battery";
let hash;
let sql = [];
let row;

beforeEach(async () => {
  hash = hash || (await bcrypt.hash(PASSWORD, 10));
  row = { user_id: 5, first_name: "Ana", last_name: "Reyes", email: "ana@example.com", password_hash: hash };
  sql = [];
  db.execute = async (text, params = []) => {
    sql.push({ text: String(text).replace(/\s+/g, " ").trim(), params });
    if (/SELECT user_id FROM users WHERE email/i.test(text)) return [[]]; // not taken
    if (/FROM users WHERE user_id/i.test(text)) return [[row]];
    return [{ affectedRows: 1 }];
  };
});

const reqFor = (body = {}) => ({
  body,
  user: { userId: 5, email: "ana@example.com" },
  context: { companyId: 1, branchId: 1, userId: 5 },
  headers: {},
  socket: { remoteAddress: "127.0.0.1" },
});

const resFor = () => {
  const res = { statusCode: 200, payload: null };
  res.status = (code) => ((res.statusCode = code), res);
  res.json = (payload) => ((res.payload = payload), res);
  return res;
};

const wrote = (pattern) => sql.filter((s) => pattern.test(s.text));

test("a password cannot be changed without the current one", async () => {
  const res = resFor();
  await changeMyPassword(reqFor({ currentPassword: "guessing", newPassword: "a long enough one" }), res);

  assert.equal(res.statusCode, 400);
  assert.equal(wrote(/SET password_hash/).length, 0, "the password was changed anyway");
});

test("a refused attempt is recorded, because that is what an attack looks like", async () => {
  // Somebody trying passwords against a screen they already have open leaves
  // no other trace at all.
  await changeMyPassword(reqFor({ currentPassword: "guessing", newPassword: "a long enough one" }), resFor());

  const audit = wrote(/INSERT INTO audit_logs/);
  assert.equal(audit.length, 1);
  assert.ok(audit[0].params.includes("account.password.refused"), audit[0].params.join(" | "));
});

test("the stored hash is one the new password actually verifies against", async () => {
  /*
   * The test that would catch a hash written from the wrong variable — which
   * looks like success and locks the person out on their next sign-in.
   */
  const res = resFor();
  await changeMyPassword(reqFor({ currentPassword: PASSWORD, newPassword: "a whole new phrase" }), res);

  assert.equal(res.statusCode, 200);
  const update = wrote(/SET password_hash/)[0];
  assert.ok(update, "nothing was written");
  assert.equal(await bcrypt.compare("a whole new phrase", update.params[0]), true);
  assert.equal(await bcrypt.compare(PASSWORD, update.params[0]), false);
});

test("the reply does not claim other sessions were ended, because they are not", async () => {
  // Stateless tokens keep working until they expire. Saying otherwise would be
  // exactly the kind of false claim this project has spent weeks removing.
  const res = resFor();
  await changeMyPassword(reqFor({ currentPassword: PASSWORD, newPassword: "another new phrase" }), res);

  assert.match(res.payload.message, /stay signed in until their session expires/);
});

test("a password that bcrypt would silently truncate is refused", async () => {
  /*
   * bcrypt hashes 72 bytes and ignores the rest, so a 90-character passphrase
   * would be stored as its first 72 and the person would believe they had
   * something stronger than they do.
   */
  const tooLong = "x".repeat(MAX_PASSWORD_BYTES + 1);
  const res = resFor();
  await changeMyPassword(reqFor({ currentPassword: PASSWORD, newPassword: tooLong }), res);

  assert.equal(res.statusCode, 400);
  assert.match(res.payload.message, /only the first 72 would actually be used/);
  assert.equal(wrote(/SET password_hash/).length, 0);
});

test("a demonstration password cannot be typed back in", async () => {
  // The server refuses to boot in production on these; letting somebody set
  // one from the profile screen would make that check a formality.
  const res = resFor();
  await changeMyPassword(reqFor({ currentPassword: PASSWORD, newPassword: "admin123" }), res);

  assert.equal(res.statusCode, 400);
  assert.match(res.payload.message, /demonstration password/);
});

test("the password policy refuses the obvious ways of being weak", () => {
  assert.equal(passwordProblem("a long good phrase", { email: "ana@example.com" }), null);
  assert.match(passwordProblem("short", {}), /at least 10 characters/);
  assert.match(passwordProblem(" leading space here", {}), /space at the start or end/);
  assert.match(passwordProblem("ana is my name", { email: "ana@example.com" }), /cannot contain your own email/);
  assert.match(passwordProblem("", {}), /Enter a new password/);
});

test("changing your name does not require your password", async () => {
  // It is not a takeover route, and demanding a password for it teaches people
  // to type their password into any box that asks.
  const res = resFor();
  await updateMyProfile(reqFor({ firstName: "Anna" }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload.data, { firstName: "Anna", lastName: "Reyes", email: "ana@example.com" });
});

test("changing the email you sign in with does require it", async () => {
  /*
   * A token lifted from an unlocked screen must not be enough to move the
   * account to an address the thief controls.
   */
  const res = resFor();
  await updateMyProfile(reqFor({ email: "someone.else@example.com" }), res);

  assert.equal(res.statusCode, 400);
  assert.equal(wrote(/UPDATE users SET first_name/).length, 0, "the email was changed anyway");
});

test("with the password, the email moves and the person is told to use it", async () => {
  const res = resFor();
  await updateMyProfile(
    reqFor({ email: "Ana.Reyes@Example.com ", currentPassword: PASSWORD }),
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.data.email, "ana.reyes@example.com", "not normalised");
  assert.match(res.payload.message, /Sign in with your new email/);
});

test("an email another account already uses is refused", async () => {
  db.execute = async (text, params = []) => {
    sql.push({ text: String(text).replace(/\s+/g, " ").trim(), params });
    if (/SELECT user_id FROM users WHERE email/i.test(text)) return [[{ user_id: 9 }]];
    if (/FROM users WHERE user_id/i.test(text)) return [[row]];
    return [{ affectedRows: 1 }];
  };

  const res = resFor();
  await updateMyProfile(reqFor({ email: "taken@example.com", currentPassword: PASSWORD }), res);

  assert.equal(res.statusCode, 409);
  assert.equal(wrote(/UPDATE users SET first_name/).length, 0);
});

test("a name cannot be emptied", async () => {
  const res = resFor();
  await updateMyProfile(reqFor({ firstName: "   " }), res);

  assert.equal(res.statusCode, 400);
  assert.equal(wrote(/UPDATE users SET first_name/).length, 0);
});
