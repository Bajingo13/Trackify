import "../../config/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import db from "../../config/db.js";
import { createDriver } from "./drivers.controller.js";
import { login } from "../driver-app/driver.controller.js";

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

const newDriverReq = (body = {}) => ({
  context: { companyId: 1, branchId: 1, userId: 9 },
  user: { userId: 9, email: "staff@example.com" },
  headers: {},
  socket: {},
  params: {},
  body: {
    firstName: "Juan",
    lastName: "Dela Cruz",
    licenseNo: "N01-23-456789",
    licenseExpiry: "2028-01-01",
    ...body,
  },
});

/** Answers the queries createDriver makes, with the peak number it should see. */
const creating = ({ peak = 0, numberTaken = false } = {}) => (sql) => {
  if (sql.includes("license_no = ?")) return [[]];                 // no licence clash
  if (sql.includes("MAX(CAST(SUBSTRING")) return [[{ top: peak }]]; // highest DRV-### so far
  if (sql.includes("employee_no = ?")) return [numberTaken ? [{ driver_id: 7 }] : []];
  if (/^\s*INSERT/i.test(sql)) return [{ insertId: 42 }];
  return [[]];
};

const insertedEmployeeNo = (calls) =>
  calls.find((c) => c.sql.startsWith("INSERT INTO drivers"))?.params?.[2];

/* ---- allocating the number ---- */

test("a driver created without a number is given the next one", async () => {
  // Nothing in the form, so the office gets DRV-006 after DRV-005 rather than
  // a driver who cannot sign in.
  await withDb(creating({ peak: 5 }), async (calls) => {
    const out = recorder();
    await createDriver(newDriverReq(), out.res);

    assert.equal(out.statusCode, 201);
    assert.equal(insertedEmployeeNo(calls), "DRV-006");
  });
});

test("the first driver at a company starts at DRV-001", async () => {
  await withDb(creating({ peak: 0 }), async (calls) => {
    await createDriver(newDriverReq(), recorder().res);
    assert.equal(insertedEmployeeNo(calls), "DRV-001");
  });
});

test("a number the office supplies is kept exactly as written", async () => {
  // Plenty of firms number their people their own way, and overwriting that
  // would be worse than not numbering at all.
  await withDb(creating({ peak: 5 }), async (calls) => {
    await createDriver(newDriverReq({ employeeNo: "OPS-2211" }), recorder().res);
    assert.equal(insertedEmployeeNo(calls), "OPS-2211");
  });
});

test("a number already belonging to somebody is refused, not duplicated", async () => {
  // Two drivers sharing a number is two drivers sharing a login.
  await withDb(creating({ peak: 5, numberTaken: true }), async (calls) => {
    const out = recorder();
    await createDriver(newDriverReq({ employeeNo: "DRV-003" }), out.res);

    assert.equal(out.statusCode, 409);
    assert.match(out.body.message, /already belongs/);
    assert.equal(insertedEmployeeNo(calls), undefined, "the driver was written anyway");
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

const loginReq = () => ({ body: { employeeNo: "DRV-001", pin: "1234" }, headers: {}, socket: {} });

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
