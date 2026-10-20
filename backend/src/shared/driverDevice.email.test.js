import { test } from "node:test";
import assert from "node:assert/strict";
import { driverDeviceCodeEmail, spacedCode } from "./driverDevice.email.js";
import { generateCode, maskEmail, normaliseCode, phoneLabel } from "../modules/driver-app/devices.service.js";

test("the code leads the subject and the message, in two easy halves", () => {
  const mail = driverDeviceCodeEmail({ name: "Juan", code: "482913", minutes: 10, employeeNo: "DRV-012", phone: "Android 14", firstPhone: true });
  assert.equal(mail.subject, "482 913 is your Trackify Driver sign-in code");
  assert.match(mail.text, /Your code: 482 913/);
  assert.match(mail.text, /Valid for: 10 minutes/);
  assert.match(mail.text, /Use: Once only/);
  assert.match(mail.html, /482 913/);
  assert.match(mail.html, /Driver sign-in/);
  assert.ok(mail.attachments.some((a) => a.cid === "astreablue-logo"), "the shared layout's logo travels with it");
});

test("a new phone on an existing account is worded as a warning", () => {
  const mail = driverDeviceCodeEmail({ name: "Juan", code: "000123", minutes: 10, firstPhone: false });
  assert.match(mail.text, /new phone/);
  assert.match(mail.text, /If this wasn't you/);
  assert.match(mail.html, /New phone/);
});

test("whatever a driver typed is escaped in the HTML", () => {
  const mail = driverDeviceCodeEmail({ name: "<b>x</b>", code: "111111", minutes: 10, firstPhone: true });
  assert.ok(!mail.html.includes("<b>x</b>"));
});

test("codes are six digits; spaces and dashes typed with them don't matter", () => {
  for (let i = 0; i < 50; i += 1) assert.match(generateCode(), /^\d{6}$/);
  assert.equal(normaliseCode("482 913"), "482913");
  assert.equal(normaliseCode("482-913"), "482913");
  assert.equal(spacedCode("482913"), "482 913");
});

test("the address is shown masked, keeping the domain", () => {
  assert.equal(maskEmail("juandelacruz@gmail.com"), "ju••••••••••@gmail.com");
  assert.equal(maskEmail("ab@gmail.com"), "a•••@gmail.com");
  assert.equal(maskEmail("not-an-email"), "");
});

test("the phone is named from its user agent", () => {
  assert.equal(phoneLabel("Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit Chrome/120"), "Android 14 · Trackify Driver app");
  assert.equal(phoneLabel(""), "");
});
