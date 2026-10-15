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
  if (sql.includes("license_key = ?") || sql.includes("employee_no = ?")) return [[]];
  if (sql.includes("MAX(CAST(SUBSTRING")) return [[{ top: 11 }]]; // the company has reached DRV-011
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
    pin: "4821", licenseReviewed: "true",
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

test("a PIN and the Admin licence review are required", async () => {
  for (const [body, code] of [
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

test("the Employee Number is assigned by the system, whatever the request says", async () => {
  engineReads(cardText());
  const { out, calls } = await register(uploadedLicence(), { employeeNo: "EMP-204" });
  assert.equal(out.statusCode, 201);
  assert.equal(inserted(calls).params[2], "DRV-012");
  assert.equal(out.body.data.employeeNo, "DRV-012");
  assert.equal(inserted(calls).params.includes("EMP-204"), false);
});

const holder = (status = "active") => ({ driver_id: 5, employee_no: "DRV-005", first_name: "Pedro", last_name: "Santos", status });

test("duplicate licence numbers are refused, naming who holds it", async () => {
  engineReads(cardText());
  const { out, calls } = await register(uploadedLicence(), {}, (sql) =>
    sql.includes("license_key = ?") ? [[holder()]] : null
  );
  assert.equal(out.statusCode, 409);
  assert.equal(out.body.code, "LICENSE_DUPLICATE");
  assert.match(out.body.message, /already belongs to Pedro Santos \(DRV-005\)/);
  assert.equal(inserted(calls), undefined);
});

test("the same licence typed with different separators is still the same licence", async () => {
  engineReads(cardText());
  const { calls } = await register(uploadedLicence(), { licenseNo: "n01 23 456789" });
  const check = calls.find((c) => c.sql.includes("license_key = ?"));
  assert.deepEqual(check.params, [1, "N0123456789", 0]);
});

test("a licence held by an inactive driver points the office to Reactivate", async () => {
  engineReads(cardText());
  const { out, calls } = await register(uploadedLicence(), {}, (sql) =>
    sql.includes("license_key = ?") ? [[holder("inactive")]] : null
  );
  assert.equal(out.statusCode, 409);
  assert.equal(out.body.code, "LICENSE_ON_INACTIVE_DRIVER");
  assert.match(out.body.message, /inactive\. Reactivate them/);
  assert.deepEqual(out.body.holder, { driverId: 5, name: "Pedro Santos", employeeNo: "DRV-005", status: "inactive" });
  assert.equal(inserted(calls), undefined);
});

test("two saves of one licence at the same moment: the database's unique key refuses the second", async () => {
  engineReads(cardText());
  let checked = 0;
  const file = uploadedLicence();
  const { out } = await register(file, {}, (sql) => {
    // clear when first checked, taken by the time the insert lands
    if (sql.includes("license_key = ?")) return checked++ ? [[holder()]] : [[]];
    if (/^INSERT INTO drivers/.test(sql)) {
      throw Object.assign(new Error("Duplicate entry '1-N0123456789' for key 'drivers.uq_driver_license_key'"), { code: "ER_DUP_ENTRY" });
    }
    return null;
  });
  assert.equal(out.statusCode, 409);
  assert.equal(out.body.code, "LICENSE_DUPLICATE");
  assert.equal(await goneSoon(file), true, "the photo is not left behind");
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

test("an expiry year no licence could have is refused before anything is read or written", async () => {
  // 2099 for 2029: accepted, it would have silenced every warning for this driver
  const file = uploadedLicence();
  const { out, calls } = await register(file, { licenseExpiry: "2099-01-01" });
  assert.equal(out.statusCode, 400);
  assert.equal(out.body.code, "LICENSE_EXPIRY_IMPLAUSIBLE");
  assert.equal(inserted(calls), undefined);
  assert.equal(await goneSoon(file), true);
});
