import "../../config/env.js";
import fs from "node:fs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import db from "../../config/db.js";
import { createDriver, updateDriver } from "./drivers.controller.js";
import { login } from "../driver-app/driver.controller.js";
import { useSignInResolver } from "../driver-app/devices.service.js";
import { cardText, engineReads, engineOff, uploadedLicence, cleanUploads } from "../../shared/licenseScan/cardFixture.js";

process.env.JWT_SECRET = process.env.JWT_SECRET || "employee-no-test-secret";

/**
 * The number a driver signs in with.
 *
 * The Driver App authenticates on employee_no, and nothing ever set it: the
 * Add Driver form had no field, while the web screens displayed a number
 * derived from the row id and told the office to hand it over. It was never
 * stored, so every driver added through the web met a login that matched NULL.
 *
 * These cover the two halves of fixing that — a number is always allocated,
 * and it is never handed out twice — plus the consequence of making it unique
 * per company rather than globally: the Driver App is not told which company
 * the driver belongs to, so two firms can each hold a DRV-001.
 */

async function withDb(handler, fn) {
  const real = db.execute;
  const calls = [];
  db.execute = async (sql, params) => {
    calls.push({ sql: String(sql).replace(/\s+/g, " ").trim(), params });
    return handler(String(sql), params);
  };
  try {
    return await fn(calls);
  } finally {
    db.execute = real;
  }
}

function recorder() {
  const out = { statusCode: 200 };
  out.res = {
    status(code) { out.statusCode = code; return this; },
    json(value) { out.body = value; return this; },
  };
  return out;
}

// Registering needs a licence photo that matches the details entered, so every
// registration here comes with a card that says what the request says.
beforeEach(() => { engineReads(cardText()); });
afterEach(() => { engineOff(); cleanUploads(); });

const newDriverReq = (body = {}) => ({
  file: uploadedLicence(),
  context: { companyId: 1, branchId: 1, userId: 9 },
  user: { userId: 9, email: "staff@example.com" },
  headers: {},
  socket: {},
  params: {},
  body: {
    firstName: "Juan",
    lastName: "Dela Cruz",
    phone: "09171234567",
    pin: "1234",
    licenseReviewed: "true",
    licenseNo: "N01-23-456789",
    licenseExpiry: "2028-01-01",
    ...body,
  },
});

/**
 * Answers the queries createDriver makes.
 *   peak     the highest DRV-### the company already has
 *   taken    numbers that already belong to somebody
 *   raceFor  numbers another registration grabs between our check and our insert
 */
const creating = ({ peak = 0, taken = [], raceFor = [] } = {}) => (sql, params) => {
  if (sql.includes("license_key = ?")) return [[]];                // no licence clash
  if (sql.includes("MAX(CAST(SUBSTRING")) return [[{ top: peak }]]; // highest DRV-### so far
  if (sql.includes("employee_no = ?")) return [taken.includes(params[0]) ? [{ driver_id: 7 }] : []];
  if (/^\s*INSERT INTO drivers/i.test(sql)) {
    if (raceFor.includes(params[2])) {
      raceFor.splice(raceFor.indexOf(params[2]), 1);
      taken.push(params[2]); // the other registration now holds it
      // what the unique key says when somebody else got there first
      throw Object.assign(new Error(`Duplicate entry '1-${params[2]}' for key 'drivers.uq_driver_employee_no'`), { code: "ER_DUP_ENTRY" });
    }
    return [{ insertId: 42 }];
  }
  return [[]];
};

const inserts = (calls) => calls.filter((c) => c.sql.startsWith("INSERT INTO drivers"));
const insertedEmployeeNo = (calls) => inserts(calls).at(-1)?.params?.[2];

/* ---- the system assigns the number ---- */

test("a new driver is given the next number in the company's sequence, and the office is told it", async () => {
  await withDb(creating({ peak: 5 }), async (calls) => {
    const out = recorder();
    await createDriver(newDriverReq(), out.res);

    assert.equal(out.statusCode, 201);
    assert.equal(insertedEmployeeNo(calls), "DRV-006");
    assert.deepEqual(out.body.data, { driverId: 42, employeeNo: "DRV-006" }, "the office hands this to the driver with the PIN");
  });
});

test("the first driver at a company starts at DRV-001", async () => {
  await withDb(creating({ peak: 0 }), async (calls) => {
    await createDriver(newDriverReq(), recorder().res);
    assert.equal(insertedEmployeeNo(calls), "DRV-001");
  });
});

test("a number sent in the request is ignored: only the system assigns them", async () => {
  // Typed numbers were how two drivers could end up sharing a sign-in name.
  await withDb(creating({ peak: 5, taken: ["DRV-003"] }), async (calls) => {
    const out = recorder();
    await createDriver(newDriverReq({ employeeNo: "DRV-003" }), out.res);
    assert.equal(out.statusCode, 201);
    assert.equal(insertedEmployeeNo(calls), "DRV-006");
  });
});

test("a number already in use is stepped over, never duplicated", async () => {
  // e.g. one given by hand before allocation was automatic
  await withDb(creating({ peak: 5, taken: ["DRV-006", "DRV-007"] }), async (calls) => {
    await createDriver(newDriverReq(), recorder().res);
    assert.equal(insertedEmployeeNo(calls), "DRV-008");
  });
});

test("two registrations at the same moment: the one that loses the race takes the next number", async () => {
  await withDb(creating({ peak: 5, raceFor: ["DRV-006"] }), async (calls) => {
    const out = recorder();
    await createDriver(newDriverReq(), out.res);
    assert.equal(out.statusCode, 201);
    assert.equal(inserts(calls).length, 2, "it tried again rather than failing");
    // the competing registration now holds 006, so the retry takes 007
    assert.equal(insertedEmployeeNo(calls), "DRV-007");
    assert.equal(out.body.data.employeeNo, "DRV-007");
  });
});

test("a lost race is retried a bounded number of times, then reported; the photo is not left behind", async () => {
  const req = newDriverReq();
  await withDb(creating({ peak: 5, raceFor: ["DRV-006", "DRV-007", "DRV-008", "DRV-009", "DRV-010"] }), async (calls) => {
    await assert.rejects(createDriver(req, recorder().res), /uq_driver_employee_no/);
    assert.equal(inserts(calls).length, 5);
  });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(fs.existsSync(req.file.path), false);
});

test("any other database error is not mistaken for a race", async () => {
  await withDb((sql, params) => {
    if (/^\s*INSERT INTO drivers/i.test(sql)) throw Object.assign(new Error("Duplicate entry for key 'drivers.PRIMARY'"), { code: "ER_DUP_ENTRY" });
    return creating({ peak: 1 })(sql, params);
  }, async (calls) => {
    await assert.rejects(createDriver(newDriverReq(), recorder().res), /PRIMARY/);
    assert.equal(inserts(calls).length, 1);
  });
});

/* ---- and it cannot be changed afterwards ---- */

const editReq = (body) => ({
  context: { companyId: 1, branchId: 1, userId: 9 },
  user: { userId: 9, email: "staff@example.com" },
  headers: {}, socket: {}, params: { id: "7" }, body,
});
const existingDriver = (sql) => (sql.startsWith("SELECT driver_id, status, employee_no")
  ? [[{ driver_id: 7, status: "active", employee_no: "DRV-007", license_no: "N01-23-456789" }]]
  : [{ affectedRows: 1 }]);

test("an Employee Number cannot be changed: it is the driver's sign-in name", async () => {
  await withDb(existingDriver, async (calls) => {
    const out = recorder();
    await updateDriver(editReq({ employeeNo: "DRV-999", phone: "0999" }), out.res);
    assert.equal(out.statusCode, 400);
    assert.equal(out.body.code, "EMPLOYEE_NUMBER_READ_ONLY");
    assert.equal(calls.some((c) => c.sql.startsWith("UPDATE drivers")), false, "nothing else was saved either");
  });
});

test("sending the same number back with an edit is harmless, and is not written", async () => {
  await withDb(existingDriver, async (calls) => {
    const out = recorder();
    await updateDriver(editReq({ employeeNo: "DRV-007", phone: "0999" }), out.res);
    assert.equal(out.statusCode, 200);
    const update = calls.find((c) => c.sql.startsWith("UPDATE drivers"));
    assert.doesNotMatch(update.sql, /employee_no/);
  });
});

/* ---- signing in with it ---- */

const driverRow = (overrides) => ({
  driver_id: 1,
  company_id: 1,
  home_branch_id: 1,
  first_name: "Juan",
  last_name: "Dela Cruz",
  ...overrides,
});

const loginReq = () => ({
  body: { employeeNo: "DRV-001", pin: "1234" },
  headers: { "x-driver-device": "a-phone-key-that-is-long-enough-000000" },
  socket: {},
});

// Which phone it is, is devices.service.js's question and is tested there; here it is the trusted one.
let restoreResolver;
beforeEach(() => { restoreResolver = useSignInResolver(async () => ({ outcome: "trusted", deviceId: 1 })); });
afterEach(() => restoreResolver());

test("the right PIN on a single account signs in", async () => {
  const pin_hash = await bcrypt.hash("1234", 10);
  await withDb(
    () => [[driverRow({ pin_hash })]],
    async () => {
      const out = recorder();
      await login(loginReq(), out.res);

      assert.equal(out.body.success, true);
      assert.ok(out.body.data.token, "no token issued");
      assert.equal(out.body.data.driver.employeeNo, "DRV-001");
    }
  );
});

test("a wrong PIN is refused", async () => {
  const pin_hash = await bcrypt.hash("9999", 10);
  await withDb(
    () => [[driverRow({ pin_hash })]],
    async () => {
      const out = recorder();
      await login(loginReq(), out.res);
      assert.equal(out.statusCode, 401);
    }
  );
});

test("the same number and PIN at two companies signs nobody in", async () => {
  /*
   * employee_no is unique within a company, not across the system, and this
   * screen is never told which company the driver belongs to. Two firms can
   * each have a DRV-001, and four-digit PINs repeat. Taking the first match
   * would hand somebody another company's trips — so it refuses and says what
   * to do about it.
   */
  const pin_hash = await bcrypt.hash("1234", 10);
  await withDb(
    () => [[
      driverRow({ driver_id: 1, company_id: 1, pin_hash }),
      driverRow({ driver_id: 2, company_id: 2, pin_hash }),
    ]],
    async () => {
      const out = recorder();
      await login(loginReq(), out.res);

      assert.equal(out.statusCode, 409);
      assert.match(out.body.message, /more than one account/);
      assert.equal(out.body.data, undefined, "a token was issued for an ambiguous sign-in");
    }
  );
});

test("two accounts sharing a number but not a PIN still sign in cleanly", async () => {
  // The ambiguity is the pair, not the number. Refusing on the number alone
  // would lock out drivers over a coincidence at another company.
  await withDb(
    async () => [[
      driverRow({ driver_id: 1, company_id: 1, pin_hash: await bcrypt.hash("1234", 10) }),
      driverRow({ driver_id: 2, company_id: 2, pin_hash: await bcrypt.hash("4321", 10) }),
    ]],
    async () => {
      const out = recorder();
      await login(loginReq(), out.res);

      assert.equal(out.body.success, true);
      assert.equal(out.body.data.driver.driverId, 1);
    }
  );
});

/* ---- one sequence for every company ---- */

test("numbers continue one system-wide sequence, so no two companies share one", async () => {
  // The Driver App is not told the company at sign-in; a DRV-001 at every
  // company left PIN alone to tell those drivers apart.
  await withDb(creating({ peak: 40 }), async (calls) => {
    await createDriver(newDriverReq(), recorder().res);
    const peak = calls.find((c) => c.sql.includes("MAX(CAST(SUBSTRING"));
    assert.doesNotMatch(peak.sql, /company_id/, "the highest number is looked up across all companies");
    const clash = calls.find((c) => /^SELECT driver_id FROM drivers WHERE employee_no = \? LIMIT 1/.test(c.sql));
    assert.deepEqual(clash.params, ["DRV-041"], "and so is whether it is taken");
    assert.equal(insertedEmployeeNo(calls), "DRV-041");
  });
});

test("two companies registering at the same moment: the later one moves to the next number before anyone is told", async () => {
  // Both saw DRV-040 as the highest; the other company's row (id 41) was written first.
  let inserted = false;
  await withDb((sql, params) => {
    if (sql.includes("employee_no = ? AND driver_id < ?")) {
      return [params[0] === "DRV-041" ? [{ driver_id: 41 }] : []];
    }
    if (sql.includes("MAX(CAST(SUBSTRING")) return [[{ top: inserted ? 41 : 40 }]];
    if (/^INSERT INTO drivers/.test(sql)) inserted = true;
    if (sql.startsWith("UPDATE drivers SET employee_no")) return [{ affectedRows: 1 }];
    return creating({ peak: 40 })(sql, params);
  }, async (calls) => {
    const out = recorder();
    await createDriver(newDriverReq(), out.res);
    const moved = calls.find((c) => c.sql.startsWith("UPDATE drivers SET employee_no"));
    assert.deepEqual(moved.params, ["DRV-042", 42]);
    assert.equal(out.body.data.employeeNo, "DRV-042", "the office is told the number the driver actually has");
  });
});
