import "../src/config/env.js";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import db from "../src/config/db.js";
import { deviceStatus, login, regenerateRecoveryCodes, verifyDevice } from "../src/modules/driver-app/driver.controller.js";
import { authenticateDriver } from "../src/modules/driver-app/driver.middleware.js";
import { approveDevice, listDevices, resetDevices, revokeDevice } from "../src/modules/fleet/driverDevices.controller.js";
import { CODE_COUNT, MAX_VERIFY_FAILURES, normaliseCode } from "../src/modules/driver-app/devices.service.js";

/**
 * One trusted phone per driver, against the real schema.
 *
 * A PIN used to be the whole account. These walk the ways a second phone can
 * and cannot get in: it waits; a recovery code or the office lets it in; the
 * phone it replaces is signed out on its next request; a token is no good
 * without the phone it was issued to; wrong codes run out; a phone the office
 * signs out stays out.
 */

process.env.JWT_SECRET ||= "driver-devices-test-secret";
const PIN = "4826";
const COMPANY = 1;

const phone = (name) => `test-phone-${name}`.padEnd(43, "x");

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
async function newDriver() {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const employeeNo = `DT${suffix}`.slice(0, 20);
  const [r] = await db.execute(
    `INSERT INTO drivers (company_id, home_branch_id, first_name, last_name, license_no, license_expiry,
                          employee_no, status, app_enabled, pin_hash)
     VALUES (?, NULL, 'Dev', 'Ice', ?, '2099-01-01', ?, 'active', 1, ?)`,
    [COMPANY, `LND-${suffix}`, employeeNo, await bcrypt.hash(PIN, 4)]
  );
  created.push(r.insertId);
  return { driverId: r.insertId, employeeNo };
}

after(async () => {
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

async function verify(pendingToken, recoveryCode, key) {
  const res = response();
  await verifyDevice({ body: { pendingToken, recoveryCode }, headers: { "x-driver-device": key }, socket: {} }, res);
  return res;
}

async function checkStatus(pendingToken, key) {
  const res = response();
  await deviceStatus({ body: { pendingToken }, headers: { "x-driver-device": key } }, res);
  return res.body.data;
}

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

test("an app that sends no phone key is told to update, not let in on the PIN alone", async () => {
  const { employeeNo } = await newDriver();
  const res = response();
  await login({ body: { employeeNo, pin: PIN }, headers: {}, socket: {} }, res);
  assert.equal(res.statusCode, 426);
});

test("the first phone becomes the trusted one and is given recovery codes, once", async () => {
  const { employeeNo } = await newDriver();
  const first = await signIn(employeeNo, phone("a"));
  assert.equal(first.statusCode, 200);
  assert.ok(first.body.data.token);
  assert.equal(first.body.data.recoveryCodes.length, CODE_COUNT);
  assert.match(first.body.data.recoveryCodes[0], /^[2-9A-HJKMNP-Z]{5}-[2-9A-HJKMNP-Z]{5}$/);

  const again = await signIn(employeeNo, phone("a"));
  assert.ok(again.body.data.token, "the same phone signs straight in");
  assert.equal(again.body.data.recoveryCodes, undefined, "codes are shown only when they are made");
  assert.equal((await call(again.body.data.token, phone("a"))).passed, true);
});

test("a token is no good without the phone it was issued to", async () => {
  const { employeeNo } = await newDriver();
  const { token } = (await signIn(employeeNo, phone("a"))).body.data;
  const copied = await call(token, phone("thief"));
  assert.equal(copied.passed, false);
  assert.equal(copied.res.statusCode, 401);
  const noHeader = await call(token, undefined);
  assert.equal(noHeader.passed, false);
});

test("a second phone waits, and sees nothing, until a recovery code moves the account to it", async () => {
  const { employeeNo, driverId } = await newDriver();
  const first = (await signIn(employeeNo, phone("old"))).body.data;

  const second = await signIn(employeeNo, phone("new"));
  assert.equal(second.statusCode, 200, "the PIN was right; this is not a failed sign-in");
  assert.equal(second.body.data.status, "device_verification_required");
  assert.equal(second.body.data.token, undefined, "a waiting phone is given no session");
  const { pendingToken } = second.body.data;
  assert.equal((await call(pendingToken, phone("new"))).passed, false, "the pending token opens nothing");

  const wrong = await verify(pendingToken, "AAAAA-AAAAA", phone("new"));
  assert.equal(wrong.statusCode, 401);
  assert.equal(wrong.body.attemptsLeft, MAX_VERIFY_FAILURES - 1);

  // the right code, but from a phone the pending token was not issued to
  const elsewhere = await verify(pendingToken, first.recoveryCodes[0], phone("thief"));
  assert.equal(elsewhere.statusCode, 401);

  // written down in lower case, without the dash: still the same code
  const typed = normaliseCode(first.recoveryCodes[0]).toLowerCase();
  const ok = await verify(pendingToken, typed, phone("new"));
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.data.codesLeft, CODE_COUNT - 1);

  assert.equal((await call(ok.body.data.token, phone("new"))).passed, true, "the new phone works");
  assert.equal((await call(first.token, phone("old"))).passed, false, "the old phone is signed out");

  const [[failures]] = await db.execute("SELECT device_verify_failures AS n FROM drivers WHERE driver_id = ?", [driverId]);
  assert.equal(failures.n, 0, "a right code clears the count of wrong ones");

  // A code works once.
  const third = (await signIn(employeeNo, phone("third"))).body.data;
  const reused = await verify(third.pendingToken, first.recoveryCodes[0], phone("third"));
  assert.equal(reused.statusCode, 401);
});

test("wrong codes stop counting once the driver signs in on their own phone", async () => {
  const { employeeNo, driverId } = await newDriver();
  await signIn(employeeNo, phone("own"));
  const { pendingToken } = (await signIn(employeeNo, phone("new"))).body.data;
  await verify(pendingToken, "AAAAA-AAAAA", phone("new"));
  await verify(pendingToken, "AAAAA-AAAAA", phone("new"));
  await signIn(employeeNo, phone("own"));
  const [[row]] = await db.execute("SELECT device_verify_failures AS n FROM drivers WHERE driver_id = ?", [driverId]);
  assert.equal(row.n, 0);
});

test("too many wrong codes lock the driver out of moving phones until the office resets them", async () => {
  const { employeeNo, driverId } = await newDriver();
  const first = (await signIn(employeeNo, phone("old"))).body.data;
  const { pendingToken } = (await signIn(employeeNo, phone("new"))).body.data;

  let last;
  for (let i = 0; i < MAX_VERIFY_FAILURES; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    last = await verify(pendingToken, "ZZZZZ-ZZZZZ", phone("new"));
  }
  assert.equal(last.statusCode, 423);

  const right = await verify(pendingToken, first.recoveryCodes[0], phone("new"));
  assert.equal(right.statusCode, 423, "even a right code is refused once locked");
  assert.equal((await call(first.token, phone("old"))).passed, true, "the trusted phone keeps working");

  const reset = response();
  await resetDevices(office(driverId), reset);
  assert.equal(reset.statusCode, 200);
  assert.equal((await call(first.token, phone("old"))).passed, false, "a reset signs every phone out");

  const fresh = await signIn(employeeNo, phone("new"));
  assert.ok(fresh.body.data.token, "after a reset the next phone becomes the trusted one");
  assert.equal(fresh.body.data.recoveryCodes.length, CODE_COUNT);
});

test("the office can approve a waiting phone, only after confirming it called the driver", async () => {
  const { employeeNo, driverId } = await newDriver();
  const first = (await signIn(employeeNo, phone("old"))).body.data;
  const { pendingToken } = (await signIn(employeeNo, phone("new"))).body.data;

  const listed = response();
  await listDevices(office(driverId), listed);
  const pending = listed.body.data.devices.find((d) => d.status === "pending");
  assert.ok(pending, "the waiting phone is listed for the office");

  assert.equal((await checkStatus(pendingToken, phone("new"))).status, "waiting");

  const unconfirmed = response();
  await approveDevice(office(driverId, { params: { deviceId: String(pending.id) } }), unconfirmed);
  assert.equal(unconfirmed.statusCode, 400);

  const approved = response();
  await approveDevice(office(driverId, { params: { deviceId: String(pending.id) }, body: { confirmedByCall: true } }), approved);
  assert.equal(approved.statusCode, 200, JSON.stringify(approved.body));

  const copied = await checkStatus(pendingToken, phone("thief"));
  assert.equal(copied.status, "refused", "the approval's session goes only to the phone that asked");
  assert.equal(copied.token, undefined);

  const status = await checkStatus(pendingToken, phone("new"));
  assert.equal(status.status, "approved");
  assert.equal((await call(status.token, phone("new"))).passed, true);
  assert.equal((await call(first.token, phone("old"))).passed, false);
});

test("a phone the office signs out stays out, and the PIN alone does not hand the account to the next phone", async () => {
  const { employeeNo, driverId } = await newDriver();
  const first = (await signIn(employeeNo, phone("stolen"))).body.data;
  const session = await call(first.token, phone("stolen"));

  const wrongPin = response();
  await regenerateRecoveryCodes({ ...session.req, driver: session.req.driver, body: { pin: "0000" } }, wrongPin);
  assert.equal(wrongPin.statusCode, 403);
  const fresh = response();
  await regenerateRecoveryCodes({ ...session.req, driver: session.req.driver, body: { pin: PIN } }, fresh);
  assert.equal(fresh.body.data.recoveryCodes.length, CODE_COUNT);

  const revoked = response();
  await revokeDevice(office(driverId, { params: { deviceId: String((await activeDevice(driverId)).device_id) } }), revoked);
  assert.equal(revoked.statusCode, 200);
  assert.equal((await call(first.token, phone("stolen"))).passed, false, "signed out at once");

  // Whoever has the stolen phone and knows the PIN:
  const again = await signIn(employeeNo, phone("stolen"));
  assert.equal(again.statusCode, 403, "a blocked phone cannot sign back in");
  assert.equal(again.body.data, undefined);

  // ...or tries from a phone of their own. No trusted phone is left, but set-up is closed.
  const other = await signIn(employeeNo, phone("thiefs-own"));
  assert.equal(other.body.data.status, "device_verification_required");
  assert.equal(other.body.data.token, undefined);
  assert.equal(other.body.data.recoveryCodes, undefined, "no fresh codes for whoever asks first");

  // The driver, on their replacement phone, uses a code they wrote down.
  const mine = (await signIn(employeeNo, phone("replacement"))).body.data;
  const ok = await verify(mine.pendingToken, fresh.body.data.recoveryCodes[0], phone("replacement"));
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  assert.equal((await call(ok.body.data.token, phone("replacement"))).passed, true);

  // A reset does not unblock the stolen phone.
  await resetDevices(office(driverId), response());
  assert.equal((await signIn(employeeNo, phone("stolen"))).statusCode, 403);
});

test("notifications set up before phones were recorded stay with the first phone set up", async () => {
  const { employeeNo, driverId } = await newDriver();
  const hash = String(driverId).padStart(64, "0");
  await db.execute(
    `INSERT INTO driver_push_subscriptions (company_id, driver_id, endpoint, endpoint_hash, p256dh, auth)
     VALUES (?, ?, 'https://push.example/x', ?, 'k', 'a')`,
    [COMPANY, driverId, hash]
  );
  await signIn(employeeNo, phone("a"));
  const [[sub]] = await db.execute("SELECT device_id FROM driver_push_subscriptions WHERE endpoint_hash = ?", [hash]);
  assert.ok(sub, "the subscription was kept");
  assert.equal(sub.device_id, (await activeDevice(driverId)).device_id);
});
