/**
 * Which company/branch the end-to-end suites operate in.
 *
 * Two things make this worth a shared helper rather than an `access[0]` in
 * every suite:
 *
 *   1. Every /api/v1 route requires BOTH a company and a branch. A System
 *      Administrator's access list leads with a company-wide row whose branch
 *      is null, so `access[0]` sends no branch and every call comes back 400
 *      — "Company and branch operating context are required."
 *   2. The seeded fixtures are not spread evenly — every demo trip belongs to
 *      one branch. Picking whichever branch happens to sort first lands the
 *      suite in a branch with no trips, where the API correctly answers 404
 *      and the suite reports a failure that says nothing about the product.
 *
 * So: prefer the branch the fixtures live in, then any branch at all, then
 * whatever came first. Override with TRACKIFY_TEST_BRANCH (a branch code).
 */

import crypto from "node:crypto";
import { refuseProductionDatabase } from "../src/shared/productionDatabaseGuard.js";

export const FIXTURE_BRANCH_CODE = process.env.TRACKIFY_TEST_BRANCH || "DVO";

/*
 * The test phone.
 *
 * A driver signs in from one trusted phone (devices.service.js): every Driver
 * App request carries the phone's key in X-Driver-Device, and a phone the
 * system has not seen waits for an emailed code or the office. A suite is not
 * a phone that can read email, so each fixture driver gets one fixed test key,
 * trusted directly in the test database.
 *
 * Only for a driver with no trusted phone yet — a fresh CI database. A driver
 * who already has one (a real phone on a shared dev database) is left exactly
 * as they are, and the suite is told the fixture is missing instead: on 21 Oct
 * a test that swapped a phone's key locked a real driver's phone out.
 */
// at least 32 characters, as the server requires of every phone's key
export const testPhoneKey = (employeeNo) =>
  `trackify-e2e-test-phone-key-${String(employeeNo).replace(/[^A-Za-z0-9_-]/g, "")}`;

/** A well-formed key for an account that does not exist (the throttle suite's "ghosts"). */
export const anyPhoneKey = () => `trackify-e2e-any-phone-${crypto.randomBytes(8).toString("hex")}`;

/**
 * Make the test phone trusted for this driver, if nothing else is.
 * @returns {{ key: string } | { missing: string }}
 */
export async function trustTestPhone(db, employeeNo) {
  refuseProductionDatabase("trusting a test phone for the end-to-end suites");
  const key = testPhoneKey(employeeNo);
  const hash = crypto.createHash("sha256").update(key).digest("hex");
  const [drivers] = await db.execute(
    "SELECT driver_id AS id, company_id AS companyId FROM drivers WHERE employee_no = ? AND status = 'active'",
    [employeeNo],
  );
  if (!drivers.length) return { missing: `fixture missing: no active driver ${employeeNo}` };
  for (const d of drivers) {
    const [active] = await db.execute(
      "SELECT key_hash AS keyHash FROM driver_devices WHERE driver_id = ? AND status = 'active'",
      [d.id],
    );
    if (active.some((row) => row.keyHash === hash)) continue;
    if (active.length) {
      return { missing: `fixture missing: ${employeeNo} already has a trusted phone, which a test will not replace` };
    }
    await db.execute(
      `INSERT INTO driver_devices (company_id, driver_id, key_hash, user_agent, status, approved_via, approved_at)
       VALUES (?, ?, ?, 'Trackify end-to-end tests', 'active', 'office', NOW(3))
       ON DUPLICATE KEY UPDATE status = 'active', approved_via = 'office', approved_at = NOW(3),
                               revoked_at = NULL, revoked_reason = NULL`,
      [d.companyId, d.id, hash],
    );
  }
  return { key };
}

/* Used only when a suite has no database pool of its own — the login payload
 * carries branch names but not codes, so the code is matched by its name. */
const NAME_BY_CODE = {
  DVO: "Davao",
  CEB: "Cebu",
  GEN: "General Santos",
  MKT: "Makati",
};

/**
 * @param access the `data.access` array from a staff login response
 * @param db     optional mysql pool; when given, the branch code is resolved
 *               against the branches table rather than matched by name
 * @returns the access entry to send as X-Company-Id / X-Branch-Id
 */
export async function operatingScope(access, db = null) {
  const list = Array.isArray(access) ? access : [];
  let preferred = null;

  if (db) {
    try {
      const [[row]] = await db.execute(
        `SELECT branch_id FROM branches WHERE branch_code = ? AND status = 'active' LIMIT 1`,
        [FIXTURE_BRANCH_CODE],
      );
      if (row) {
        preferred = list.find(
          (a) => Number(a.branch_id) === Number(row.branch_id),
        );
      }
    } catch {
      /* fall through to the name match below */
    }
  }

  if (!preferred) {
    const name = NAME_BY_CODE[FIXTURE_BRANCH_CODE];
    if (name) {
      preferred = list.find((a) =>
        String(a.branch_name || "")
          .toLowerCase()
          .startsWith(name.toLowerCase()),
      );
    }
  }

  return preferred || list.find((a) => a.branch_id) || list[0] || {};
}

/** The headers every staff-side suite sends. */
export async function staffHeaders(loginJson, db = null) {
  const a = await operatingScope(loginJson?.data?.access, db);
  return {
    Authorization: `Bearer ${loginJson?.data?.token}`,
    "X-Company-Id": String(a.company_id ?? ""),
    "X-Branch-Id": String(a.branch_id ?? ""),
    "Content-Type": "application/json",
  };
}
