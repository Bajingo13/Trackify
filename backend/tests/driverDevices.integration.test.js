import "../src/config/env.js";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import db from "../src/config/db.js";
import {
  askOfficeForDevice, deviceStatus, login, resendDeviceEmail, verifyDevice,
} from "../src/modules/driver-app/driver.controller.js";
import { authenticateDriver } from "../src/modules/driver-app/driver.middleware.js";
import {
  approveDevice, listDevices, pendingDevices, resetDevices, revokeDevice, unblockDevice,
} from "../src/modules/fleet/driverDevices.controller.js";
import {
  MAX_CODE_ATTEMPTS, MAX_VERIFY_FAILURES, useCodeMailer,
} from "../src/modules/driver-app/devices.service.js";

/**
 * One trusted phone per driver, verified by an emailed code, against the real
 * schema. Nothing is mailed: the code mailer is swapped for one that keeps
 * each message, and the code is read back out of it, as a driver would.
 *
 * These walk the ways a phone can and cannot get in: a new account's first
 * phone and any later phone wait for the code; the office can approve instead;
 * the phone a new one replaces is signed out; a token is no good without the
 * phone it was issued to; a code works once, for a while, on one phone; wrong
 * codes run out; a phone the office signs out stays out.
 */

process.env.JWT_SECRET ||= "driver-devices-test-secret";
const PIN = "4826";
const COMPANY = 1;

const phone = (name) => `test-phone-${name}`.padEnd(43, "x");

let outbox = [];
let mailWorks = true;
let restoreMailer;
before(() => {
  restoreMailer = useCodeMailer(async (msg) => {
    if (!mailWorks) return { sent: false, reason: "smtp down" };
    outbox.push(msg);
    return { sent: true };
  });
});

/** The code in the last email sent to `to`. */
function lastCode(to) {
  const msg = [...outbox].reverse().find((m) => m.to === to);
  assert.ok(msg, `an email went to ${to}`);
  const [, a, b] = msg.text.match(/Your code: (\d{3}) (\d{3})/);
  return `${a}${b}`;
}

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    set() { return this; },
  };
}

const created = [];
async function newDriver({ withEmail = true } = {}) {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const employeeNo = `DT${suffix}`.slice(0, 20);
  const email = withEmail ? `dt${suffix}@example.test` : null;
  const [r] = await db.execute(
    `INSERT INTO drivers (company_id, home_branch_id, first_name, last_name, license_no, license_expiry,
                          employee_no, email, status, app_enabled, pin_hash)
     VALUES (?, NULL, 'Dev', 'Ice', ?, '2099-01-01', ?, ?, 'active', 1, ?)`,
    [COMPANY, `LND-${suffix}`, employeeNo, email, await bcrypt.hash(PIN, 4)]
  );
  created.push(r.insertId);
  return { driverId: r.insertId, employeeNo, email };
}

after(async () => {
  restoreMailer?.();
  for (const id of created) {
    await db.execute("DELETE FROM audit_logs WHERE entity_type = 'driver' AND entity_id = ?", [String(id)]);
    await db.execute("DELETE FROM driver_push_subscriptions WHERE driver_id = ?", [id]);
    await db.execute("DELETE FROM drivers WHERE driver_id = ?", [id]); // devices and codes cascade
  }
  await db.end();
});

async function signIn(employeeNo, key, pin = PIN) {
  const res = response();
  await login({ body: { employeeNo, pin }, headers: { "x-driver-device": key, "user-agent": "test" }, socket: {} }, res);
  return res;
}

async function call(token, key) {
  const res = response();
  let passed = false;
  const req = { headers: { authorization: `Bearer ${token}`, "x-driver-device": key } };
  await authenticateDriver(req, res, () => { passed = true; });
  return { passed, res, req };
}

async function pendingCall(handler, pendingToken, key, body = {}) {
  const res = response();
  await handler({ body: { pendingToken, ...body }, headers: { "x-driver-device": key, "user-agent": "test" }, socket: {} }, res);
  return res;
}
const verify = (pendingToken, code, key) => pendingCall(verifyDevice, pendingToken, key, { code });
const resend = (pendingToken, key) => pendingCall(resendDeviceEmail, pendingToken, key);
const checkStatus = async (pendingToken, key) => (await pendingCall(deviceStatus, pendingToken, key)).body.data;

/** Sign in on a phone and enter the code the email brought: the whole of a normal first sign-in. */
async function setUpPhone(driver, key) {
  const waiting = (await signIn(driver.employeeNo, key)).body.data;
  const ok = await verify(waiting.pendingToken, lastCode(driver.email), key);
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  return ok.body.data.token;
}

/** Let the resend wait pass, as if a minute had gone by. */
const ageCodes = (driverId) =>
  db.execute("UPDATE driver_device_email_codes SET created_at = created_at - INTERVAL 2 MINUTE WHERE driver_id = ?", [driverId]);

const activeDevice = async (driverId) =>
  (await db.execute("SELECT device_id FROM driver_devices WHERE driver_id = ? AND status = 'active'", [driverId]))[0][0];

const office = (driverId, extra = {}) => ({
  context: { companyId: COMPANY, branchId: null },
  user: { userId: null, email: "office@test" },
  headers: {},
  socket: {},
  params: { id: String(driverId), ...extra.params },
  body: extra.body || {},
});

async function officeBell() {
  const res = response();
  await pendingDevices(office(0), res);
  return res.body.data;
}

test("an app that sends no phone key is told to update, not let in on the PIN alone", async () => {
  const { employeeNo } = await newDriver();
  const res = response();
  await login({ body: { employeeNo, pin: PIN }, headers: {}, socket: {} }, res);
  assert.equal(res.statusCode, 426);
});

test("a new account's first sign-in emails a code; entering it makes this the trusted phone", async () => {
  const driver = await newDriver();
  outbox = [];
  const first = await signIn(driver.employeeNo, phone("a"));
  assert.equal(first.statusCode, 200);
  const data = first.body.data;
  assert.equal(data.status, "device_verification_required");
  assert.equal(data.token, undefined, "the PIN alone opens nothing");
  assert.equal(data.firstPhone, true);
  assert.equal(data.emailSent, true);
  assert.match(data.emailHint, /^dt.*@example\.test$/);
  assert.ok(!data.emailHint.includes(driver.email.split("@")[0]), "the address is masked");

  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].to, driver.email);
  assert.match(outbox[0].subject, /^\d{3} \d{3} is your Trackify Driver sign-in code$/);
  assert.match(outbox[0].html, /Driver sign-in/);

  assert.equal((await officeBell()).some((p) => p.driverId === driver.driverId), false,
    "a driver reading their email does not ring the office");

  const ok = await verify(data.pendingToken, lastCode(driver.email), phone("a"));
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  assert.equal((await call(ok.body.data.token, phone("a"))).passed, true);

  const again = await signIn(driver.employeeNo, phone("a"));
  assert.ok(again.body.data.token, "the trusted phone signs straight in");
  assert.equal(outbox.length, 1, "and is sent no more codes");
});

test("a driver with no email on file still sets up their first phone on the PIN", async () => {
  const { employeeNo } = await newDriver({ withEmail: false });
  const first = await signIn(employeeNo, phone("a"));
  assert.ok(first.body.data.token);
  assert.equal(first.body.data.recoveryCodes, undefined, "no paper codes any more");
});

test("a token is no good without the phone it was issued to", async () => {
  const driver = await newDriver();
  const token = await setUpPhone(driver, phone("a"));
  assert.equal((await call(token, phone("thief"))).passed, false);
  assert.equal((await call(token, undefined)).passed, false);
});

test("a second phone waits until the emailed code moves the account to it", async () => {
  const driver = await newDriver();
  const oldToken = await setUpPhone(driver, phone("old"));

  const second = await signIn(driver.employeeNo, phone("new"));
  assert.equal(second.statusCode, 200, "the PIN was right; this is not a failed sign-in");
  assert.equal(second.body.data.status, "device_verification_required");
  assert.equal(second.body.data.firstPhone, false);
  assert.equal(second.body.data.token, undefined, "a waiting phone is given no session");
  const { pendingToken } = second.body.data;
  assert.equal((await call(pendingToken, phone("new"))).passed, false, "the pending token opens nothing");
  assert.match([...outbox].reverse().find((m) => m.to === driver.email).html, /New phone/);

  const code = lastCode(driver.email);
  const wrong = await verify(pendingToken, code === "000000" ? "111111" : "000000", phone("new"));
  assert.equal(wrong.statusCode, 401);
  assert.equal(wrong.body.attemptsLeft, MAX_CODE_ATTEMPTS - 1);

  // the right code, but from a phone the pending token was not issued to
  assert.equal((await verify(pendingToken, code, phone("thief"))).statusCode, 401);

  // typed with a space, as the email shows it
  const ok = await verify(pendingToken, `${code.slice(0, 3)} ${code.slice(3)}`, phone("new"));
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  assert.equal((await call(ok.body.data.token, phone("new"))).passed, true, "the new phone works");
  assert.equal((await call(oldToken, phone("old"))).passed, false, "the old phone is signed out");

  const [[row]] = await db.execute("SELECT device_verify_failures AS n FROM drivers WHERE driver_id = ?", [driver.driverId]);
  assert.equal(row.n, 0, "a right code clears the count of wrong ones");
  const [[via]] = await db.execute("SELECT approved_via FROM driver_devices WHERE driver_id = ? AND status = 'active'", [driver.driverId]);
  assert.equal(via.approved_via, "email_code");

  // A code works once.
  const third = (await signIn(driver.employeeNo, phone("third"))).body.data;
  assert.equal((await verify(third.pendingToken, code, phone("third"))).statusCode, 401);
});

test("a code stops working when it expires, and an expired code is not counted as a guess", async () => {
  const driver = await newDriver();
  const { pendingToken } = (await signIn(driver.employeeNo, phone("a"))).body.data;
  const code = lastCode(driver.email);
  await db.execute("UPDATE driver_device_email_codes SET expires_at = NOW(3) - INTERVAL 1 SECOND WHERE driver_id = ?", [driver.driverId]);
  const late = await verify(pendingToken, code, phone("a"));
  assert.equal(late.statusCode, 410);
  assert.equal(late.body.expired, true);
  const [[row]] = await db.execute("SELECT device_verify_failures AS n FROM drivers WHERE driver_id = ?", [driver.driverId]);
  assert.equal(row.n, 0);
});

test("signing in again reuses the code; a new one is sent only after a short wait, and replaces the last", async () => {
  const driver = await newDriver();
  outbox = [];
  const { pendingToken } = (await signIn(driver.employeeNo, phone("a"))).body.data;
  await signIn(driver.employeeNo, phone("a"));
  assert.equal(outbox.length, 1, "a second tap on Sign in does not send a second email");

  const tooSoon = await resend(pendingToken, phone("a"));
  assert.equal(tooSoon.statusCode, 429);
  assert.ok(tooSoon.body.retryAfter > 0);

  const firstCode = lastCode(driver.email);
  await ageCodes(driver.driverId);
  const again = await resend(pendingToken, phone("a"));
  assert.equal(again.statusCode, 200, JSON.stringify(again.body));
  assert.equal(outbox.length, 2);
  const secondCode = lastCode(driver.email);

  if (firstCode !== secondCode) {
    assert.equal((await verify(pendingToken, firstCode, phone("a"))).statusCode, 401, "the earlier code no longer works");
  }
  assert.equal((await verify(pendingToken, secondCode, phone("a"))).statusCode, 200);
});

test("an email that can't be sent is said plainly, and leaves no live code behind", async () => {
  const driver = await newDriver();
  mailWorks = false;
  try {
    const res = (await signIn(driver.employeeNo, phone("a"))).body.data;
    assert.equal(res.emailSent, false);
    assert.match(res.emailError, /couldn't send/i);
    const [[live]] = await db.execute(
      "SELECT COUNT(*) AS n FROM driver_device_email_codes WHERE driver_id = ? AND revoked_at IS NULL AND used_at IS NULL",
      [driver.driverId]
    );
    assert.equal(live.n, 0);
  } finally {
    mailWorks = true;
  }
});

test("too many wrong tries spend a code, and too many in all lock the driver out until the office resets them", async () => {
  const driver = await newDriver();
  const oldToken = await setUpPhone(driver, phone("old"));
  const { pendingToken } = (await signIn(driver.employeeNo, phone("new"))).body.data;
  const bad = () => (lastCode(driver.email) === "999999" ? "888888" : "999999");

  let last;
  for (let i = 0; i < MAX_CODE_ATTEMPTS; i += 1) last = await verify(pendingToken, bad(), phone("new")); // eslint-disable-line no-await-in-loop
  assert.equal(last.statusCode, 401);
  assert.equal(last.body.expired, true, "the code is spent");
  assert.equal((await verify(pendingToken, lastCode(driver.email), phone("new"))).statusCode, 410, "even its right value");

  for (let n = MAX_CODE_ATTEMPTS; n < MAX_VERIFY_FAILURES; n += MAX_CODE_ATTEMPTS) {
    await ageCodes(driver.driverId); // eslint-disable-line no-await-in-loop
    assert.equal((await resend(pendingToken, phone("new"))).statusCode, 200); // eslint-disable-line no-await-in-loop
    for (let i = 0; i < MAX_CODE_ATTEMPTS; i += 1) last = await verify(pendingToken, bad(), phone("new")); // eslint-disable-line no-await-in-loop
  }
  assert.equal(last.statusCode, 423);
  assert.equal((await call(oldToken, phone("old"))).passed, true, "the trusted phone keeps working");
  assert.ok((await officeBell()).some((p) => p.driverId === driver.driverId && p.locked), "a locked-out driver is put in front of the office");

  const reset = response();
  await resetDevices(office(driver.driverId), reset);
  assert.equal(reset.statusCode, 200);
  assert.equal((await call(oldToken, phone("old"))).passed, false, "a reset signs every phone out");

  // after a reset the next phone is set up again, with a fresh emailed code
  await setUpPhone(driver, phone("new"));
});

test("a driver without their email asks the office, which approves only after confirming it called them", async () => {
  const driver = await newDriver();
  const oldToken = await setUpPhone(driver, phone("old"));
  const { pendingToken } = (await signIn(driver.employeeNo, phone("new"))).body.data;

  assert.equal((await officeBell()).some((p) => p.driverId === driver.driverId), false);
  const asked = await pendingCall(askOfficeForDevice, pendingToken, phone("new"));
  assert.equal(asked.statusCode, 200, JSON.stringify(asked.body));
  assert.ok((await officeBell()).some((p) => p.driverId === driver.driverId), "now the office's bell lists it");

  const listed = response();
  await listDevices(office(driver.driverId), listed);
  assert.equal(listed.body.data.email, driver.email);
  const pending = listed.body.data.devices.find((d) => d.status === "pending");
  assert.ok(pending.officeRequestedAt);

  assert.equal((await checkStatus(pendingToken, phone("new"))).status, "waiting");

  const unconfirmed = response();
  await approveDevice(office(driver.driverId, { params: { deviceId: String(pending.id) } }), unconfirmed);
  assert.equal(unconfirmed.statusCode, 400);

  const approved = response();
  await approveDevice(office(driver.driverId, { params: { deviceId: String(pending.id) }, body: { confirmedByCall: true } }), approved);
  assert.equal(approved.statusCode, 200, JSON.stringify(approved.body));

  const copied = await checkStatus(pendingToken, phone("thief"));
  assert.equal(copied.status, "refused", "the approval's session goes only to the phone that asked");
  assert.equal(copied.token, undefined);

  const status = await checkStatus(pendingToken, phone("new"));
  assert.equal(status.status, "approved");
  assert.equal((await call(status.token, phone("new"))).passed, true);
  assert.equal((await call(oldToken, phone("old"))).passed, false);
  assert.equal((await officeBell()).some((p) => p.driverId === driver.driverId), false, "and the bell drops it");
});

test("a phone the office signs out stays out until the office allows it again, and then still needs a code", async () => {
  const driver = await newDriver();
  const token = await setUpPhone(driver, phone("stolen"));
  const deviceId = String((await activeDevice(driver.driverId)).device_id);

  const revoked = response();
  await revokeDevice(office(driver.driverId, { params: { deviceId } }), revoked);
  assert.equal(revoked.statusCode, 200);
  assert.equal((await call(token, phone("stolen"))).passed, false, "signed out at once");

  const again = await signIn(driver.employeeNo, phone("stolen"));
  assert.equal(again.statusCode, 403, "a blocked phone cannot sign back in");

  // Someone with the PIN on a phone of their own gets only a code sent to the driver's inbox.
  const other = await signIn(driver.employeeNo, phone("thiefs-own"));
  assert.equal(other.body.data.status, "device_verification_required");
  assert.equal(other.body.data.token, undefined);

  // A reset does not unblock it either.
  await resetDevices(office(driver.driverId), response());
  assert.equal((await signIn(driver.employeeNo, phone("stolen"))).statusCode, 403);

  const unblocked = response();
  await unblockDevice(office(driver.driverId, { params: { deviceId } }), unblocked);
  assert.equal(unblocked.statusCode, 200);
  const back = await signIn(driver.employeeNo, phone("stolen"));
  assert.equal(back.body.data.status, "device_verification_required", "allowed again, but not trusted");
  const ok = await verify(back.body.data.pendingToken, lastCode(driver.email), phone("stolen"));
  assert.equal(ok.statusCode, 200);
});

test("notifications set up before phones were recorded stay with the first phone set up", async () => {
  const driver = await newDriver();
  const hash = String(driver.driverId).padStart(64, "0");
  await db.execute(
    `INSERT INTO driver_push_subscriptions (company_id, driver_id, endpoint, endpoint_hash, p256dh, auth)
     VALUES (?, ?, 'https://push.example/x', ?, 'k', 'a')`,
    [COMPANY, driver.driverId, hash]
  );
  await setUpPhone(driver, phone("a"));
  const [[sub]] = await db.execute("SELECT device_id FROM driver_push_subscriptions WHERE endpoint_hash = ?", [hash]);
  assert.ok(sub, "the subscription was kept");
  assert.equal(sub.device_id, (await activeDevice(driver.driverId)).device_id);
});
