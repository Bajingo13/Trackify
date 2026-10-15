import "../../config/env.js";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import db from "../../config/db.js";
import { createDriver } from "./drivers.controller.js";
import { ALLOWANCE, takeAllowance } from "../../shared/licenseScan/licenseScan.service.js";
import { cardText, engineReads, engineOff, uploadedLicence, stillThere, goneSoon, cleanUploads } from "../../shared/licenseScan/cardFixture.js";

afterEach(() => { engineOff(); cleanUploads(); });

function withDb(handler) {
  const calls = [];
  const real = db.execute;
  db.execute = async (sql, params) => {
    const text = String(sql).replace(/\s+/g, " ").trim();
    calls.push({ sql: text, params });
    return handler(text, params);
  };
  return { calls, restore: () => { db.execute = real; } };
}

const clear = (sql) => {
  if (sql.includes("license_no = ?") || sql.includes("employee_no = ?")) return [[]];
  if (/^INSERT INTO drivers/.test(sql)) return [{ insertId: 42 }];
  return [{}];
};

const recorder = () => {
  const out = { statusCode: 200 };
  out.res = { status(code) { out.statusCode = code; return this; }, json(value) { out.body = value; return this; } };
  return out;
};

const request = (file, body = {}) => ({
  context: { companyId: 1, branchId: 1, userId: 9 },
  user: { userId: 9, email: "staff@example.com" },
  headers: {}, socket: {}, params: {}, file,
  body: {
    employeeNo: "EMP-204", pin: "4821", licenseReviewed: "true",
    firstName: "Juan", lastName: "Dela Cruz", phone: "0917",
    licenseNo: "N01-23-456789", licenseType: "Professional", licenseExpiry: "2028-01-01",
    ...body,
  },
});

async function register(file, body = {}, override) {
  const db_ = withDb((sql, params) => override?.(sql, params) ?? clear(sql));
  const out = recorder();
  try { await createDriver(request(file, body), out.res); } finally { db_.restore(); }
  return { out, calls: db_.calls };
}

const inserted = (calls) => calls.find((call) => call.sql.startsWith("INSERT INTO drivers"));

test("Employee Number, PIN and Admin licence review are all required", async () => {
  for (const [body, code] of [
    [{ employeeNo: "" }, "EMPLOYEE_NUMBER_REQUIRED"],
    [{ pin: "12" }, "PIN_INVALID"],
    [{ licenseReviewed: "false" }, "LICENSE_REVIEW_REQUIRED"],
  ]) {
    const file = uploadedLicence();
    const { out, calls } = await register(file, body);
    assert.equal(out.statusCode, 400);
    assert.equal(out.body.code, code);
    assert.equal(inserted(calls), undefined);
    assert.equal(await goneSoon(file), true);
  }
});

test("a readable licence photo is required and a refusal writes nothing", async () => {
  engineReads("Total 1,250.00\nThank you for your business");
  const file = uploadedLicence();
  const { out, calls } = await register(file);
  assert.equal(out.statusCode, 422);
  assert.equal(out.body.code, "LICENSE_UNREADABLE");
  assert.equal(inserted(calls), undefined);
  assert.equal(await goneSoon(file), true);

  const missing = await register(null);
  assert.equal(missing.out.body.code, "LICENSE_PHOTO_REQUIRED");
});

test("an Admin correction is accepted after review even when OCR proposed a different value", async () => {
  engineReads(cardText({ licenseNo: "N01-23-456789" }));
  const { out, calls } = await register(uploadedLicence(), {
    licenseNo: "N01-23-456780",
    licenseExpiry: "2029-02-03",
    firstName: "John",
  });
  assert.equal(out.statusCode, 201);
  const insert = inserted(calls);
  assert.ok(insert.params.includes("N01-23-456780"));
  assert.ok(insert.params.includes("2029-02-03"));
  assert.ok(insert.params.includes("John"));
});

test("duplicate Employee Numbers are refused before OCR spends work", async () => {
  const reads = engineReads(cardText());
  const file = uploadedLicence();
  const { out, calls } = await register(file, {}, (sql) =>
    sql.includes("employee_no = ?") ? [[{ driver_id: 7 }]] : null
  );
  assert.equal(out.statusCode, 409);
  assert.match(out.body.message, /EMP-204.*already belongs/i);
  assert.deepEqual(reads, []);
  assert.equal(inserted(calls), undefined);
});

test("duplicate licence numbers are refused", async () => {
  engineReads(cardText());
  const { out, calls } = await register(uploadedLicence(), {}, (sql) =>
    sql.includes("license_no = ?") ? [[{ driver_id: 5 }]] : null
  );
  assert.equal(out.statusCode, 409);
  assert.match(out.body.message, /license number already exists/i);
  assert.equal(inserted(calls), undefined);
});

test("scanner overload is reported as retryable and the upload is removed", async () => {
  engineReads(cardText());
  for (let i = 0; i < ALLOWANCE.count; i += 1) takeAllowance("staff:9");
  const file = uploadedLicence();
  const { out, calls } = await register(file);
  assert.equal(out.statusCode, 429);
  assert.equal(out.body.code, "LICENSE_SCAN_FAILED");
  assert.equal(inserted(calls), undefined);
  assert.equal(await goneSoon(file), true);
});

test("credentials, profile and photo are saved atomically with a hashed PIN and enabled app access", async () => {
  engineReads(cardText());
  const file = uploadedLicence();
  const { out, calls } = await register(file);
  assert.equal(out.statusCode, 201);
  const insert = inserted(calls);
  assert.match(insert.sql, /pin_hash, app_enabled, status/);
  assert.match(insert.sql, /license_photo_path, license_photo_mime, license_photo_size/);
  const pinHash = insert.params.at(-2);
  assert.equal(await bcrypt.compare("4821", pinHash), true);
  assert.match(insert.sql, /\?, 1, \?\)$/);
  assert.equal(stillThere(file), true);
  assert.ok(calls.some((call) => call.sql.includes("audit_logs")));
});

test("a database failure leaves no licence file and no partial account", async () => {
  engineReads(cardText());
  const file = uploadedLicence();
  const db_ = withDb((sql) => {
    if (/^INSERT INTO drivers/.test(sql)) throw new Error("db down");
    return clear(sql);
  });
  try {
    await assert.rejects(createDriver(request(file), recorder().res), /db down/);
  } finally { db_.restore(); }
  assert.equal(await goneSoon(file), true);
});
