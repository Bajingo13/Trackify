import "../../config/env.js";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import db from "../../config/db.js";
import { changePin } from "./driverProfile.controller.js";
import { setDriverAppAccess } from "../fleet/drivers.controller.js";
import { generatePin, weakPinProblem } from "../../shared/driverPin.js";
import { useDriverMailer } from "../../shared/driverMail.js";
import { driverNewPinEmail, driverPinChangedEmail, driverWelcomeEmail } from "../../shared/driverPin.email.js";

/**
 * A driver's PIN: made by the system and emailed when they are registered,
 * re-sent by the office, and changed by the driver from Profile.
 */

let outbox = [];
let mailWorks = true;
const restoreMailer = useDriverMailer(async (msg) => {
  if (!mailWorks) return { sent: false };
  outbox.push(msg);
  return { sent: true };
});
after(() => restoreMailer());

async function withDb(handler, fn) {
  const real = db.execute;
  const calls = [];
  db.execute = async (sql, params) => {
    const text = String(sql).replace(/\s+/g, " ").trim();
    calls.push({ sql: text, params });
    return handler(text, params);
  };
  try { return await fn(calls); } finally { db.execute = real; }
}

function recorder() {
  const out = { statusCode: 200 };
  out.res = {
    status(code) { out.statusCode = code; return this; },
    json(value) { out.body = value; return this; },
    set() { return this; },
  };
  return out;
}

const driverReq = (body) => ({ driver: { driverId: 9, companyId: 7, employeeNo: "DRV-009" }, body, headers: {}, socket: {} });
const pinSet = (calls) => calls.find((c) => /^UPDATE drivers SET pin_hash = \?/.test(c.sql));

/* ---- the rules ---- */

test("a PIN must be 4 to 6 digits, and not one everybody tries first", () => {
  assert.equal(weakPinProblem("48261"), null);
  assert.equal(weakPinProblem("7392"), null);
  assert.match(weakPinProblem("12"), /4 to 6 digits/);
  assert.match(weakPinProblem("12a4"), /4 to 6 digits/);
  assert.match(weakPinProblem("1234"), /too easy|in order/);
  assert.match(weakPinProblem("0000"), /same digit/);
  assert.match(weakPinProblem("654321"), /in order/);
  assert.match(weakPinProblem("7890"), /in order/);
});

test("a PIN the system makes is six digits and never a weak one", () => {
  for (let i = 0; i < 200; i += 1) {
    const pin = generatePin();
    assert.match(pin, /^\d{6}$/);
    assert.equal(weakPinProblem(pin), null);
  }
});

/* ---- the emails ---- */

test("the welcome email carries the number, the PIN and how to sign in", () => {
  const mail = driverWelcomeEmail({ name: "Juan", employeeNo: "DRV-012", pin: "482913", url: "https://x/driver", companyName: "Acme" });
  assert.equal(mail.subject, "Your Trackify Driver account is ready");
  assert.match(mail.text, /Your PIN: 482913/);
  assert.match(mail.text, /Employee no\.: DRV-012/);
  assert.match(mail.text, /Change PIN/);
  assert.match(mail.html, /482913/);
  assert.match(mail.html, /https:\/\/x\/driver/);
  assert.ok(mail.attachments.some((a) => a.cid === "astreablue-logo"));
});

test("a new PIN from the office says the old one stopped working", () => {
  const mail = driverNewPinEmail({ name: "Juan", employeeNo: "DRV-012", pin: "482913", url: "https://x/driver" });
  assert.match(mail.text, /old PIN no longer works/);
});

test("the PIN-changed notice never contains a PIN, and says what to do if it wasn't them", () => {
  const mail = driverPinChangedEmail({ name: "Juan", employeeNo: "DRV-012", when: "20 Oct 2026, 3:00 pm" });
  assert.match(mail.text, /If this wasn't you, call your office/);
  assert.doesNotMatch(mail.text, /Your PIN:/);
});

/* ---- the driver changes it ---- */

test("the current PIN is asked for again; a wrong one changes nothing and does not sign the driver out", async () => {
  const pin_hash = await bcrypt.hash("482613", 4);
  await withDb((sql) => (sql.startsWith("SELECT pin_hash") ? [[{ pin_hash, email: "j@example.test", first_name: "Juan", employee_no: "DRV-009" }]] : [{}]), async (calls) => {
    const out = recorder();
    await changePin(driverReq({ currentPin: "111111", newPin: "739204" }), out.res);
    assert.equal(out.statusCode, 403, "not 401: the app reads that as signed out");
    assert.equal(out.body.code, "PIN_WRONG");
    assert.equal(pinSet(calls), undefined);
  });
});

test("a weak or unchanged new PIN is refused", async () => {
  const pin_hash = await bcrypt.hash("482613", 4);
  await withDb((sql) => (sql.startsWith("SELECT pin_hash") ? [[{ pin_hash }]] : [{}]), async (calls) => {
    for (const [newPin, code] of [["1234", "PIN_WEAK"], ["5555", "PIN_WEAK"], ["12", "PIN_WEAK"], ["482613", "PIN_SAME"]]) {
      const out = recorder();
      await changePin(driverReq({ currentPin: "482613", newPin }), out.res); // eslint-disable-line no-await-in-loop
      assert.equal(out.statusCode, 400, newPin);
      assert.equal(out.body.code, code, newPin);
    }
    assert.equal(pinSet(calls), undefined);
  });
});

test("the right current PIN changes it, stores only a hash, and emails a notice without the PIN", async () => {
  outbox = [];
  const pin_hash = await bcrypt.hash("482613", 4);
  await withDb((sql) => (sql.startsWith("SELECT pin_hash") ? [[{ pin_hash, email: "j@example.test", first_name: "Juan", employee_no: "DRV-009" }]] : [{}]), async (calls) => {
    const out = recorder();
    await changePin(driverReq({ currentPin: "482613", newPin: "739204" }), out.res);
    assert.equal(out.statusCode, 200, JSON.stringify(out.body));
    assert.equal(out.body.data.emailed, true);
    const saved = pinSet(calls).params[0];
    assert.notEqual(saved, "739204");
    assert.equal(await bcrypt.compare("739204", saved), true);
    assert.ok(calls.some((c) => c.sql.includes("audit_logs")));
  });
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].to, "j@example.test");
  assert.doesNotMatch(outbox[0].text, /739204/);
});

/* ---- the office sends a new one ---- */

const officeReq = (body) => ({
  context: { companyId: 7, branchId: 1 }, user: { userId: 3, email: "office@example.test" },
  params: { id: "9" }, body, headers: {}, socket: {},
});
const driverRow = (extra = {}) => ({ driver_id: 9, first_name: "Juan", employee_no: "DRV-009", email: "j@example.test", pin_hash: "old-hash", app_enabled: 1, ...extra });

test("the office can email a driver a new PIN it never sees", async () => {
  outbox = [];
  await withDb((sql) => (sql.startsWith("SELECT driver_id, first_name") ? [[driverRow()]] : [[]]), async (calls) => {
    const out = recorder();
    await setDriverAppAccess(officeReq({ emailPin: true }), out.res);
    assert.equal(out.statusCode, 200, JSON.stringify(out.body));
    const [, pin] = outbox[0].text.match(/Your PIN: (\d{6})/);
    assert.equal(await bcrypt.compare(pin, pinSet(calls).params[0]), true);
    assert.equal(JSON.stringify(out.body).includes(pin), false);
  });
});

test("if the new-PIN email can't be sent, the old PIN is put back", async () => {
  mailWorks = false;
  try {
    await withDb((sql) => (sql.startsWith("SELECT driver_id, first_name") ? [[driverRow()]] : [[]]), async (calls) => {
      const out = recorder();
      await setDriverAppAccess(officeReq({ emailPin: true }), out.res);
      assert.equal(out.statusCode, 502);
      const writes = calls.filter((c) => /^UPDATE drivers SET pin_hash = \?/.test(c.sql));
      assert.equal(writes.at(-1).params[0], "old-hash");
    });
  } finally {
    mailWorks = true;
  }
});

test("a driver with no email can't be sent a PIN", async () => {
  await withDb((sql) => (sql.startsWith("SELECT driver_id, first_name") ? [[driverRow({ email: null })]] : [[]]), async (calls) => {
    const out = recorder();
    await setDriverAppAccess(officeReq({ emailPin: true }), out.res);
    assert.equal(out.statusCode, 409);
    assert.equal(pinSet(calls), undefined);
  });
});
