import "../../config/env.js";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import db from "../../config/db.js";
import { listAuditLogs } from "./audit.controller.js";

/**
 * Who can read which audit entries.
 *
 * The audit log is the one table that deliberately holds rows belonging to no
 * company: a sign-in happens before an operating context exists. The first
 * version of this controller admitted those rows to everybody with
 * `OR a.company_id IS NULL`, which meant a brand-new client could read every
 * other client's sign-in addresses, IP addresses and failed attempts.
 *
 * These pin the shape of the query rather than a row count, because the fault
 * was in the WHERE clause and that is where a regression would reappear.
 */

const realExecute = db.execute.bind(db);
after(async () => {
  db.execute = realExecute;
  await db.end();
});

let queries = [];
beforeEach(() => {
  queries = [];
  db.execute = async (sql, params = []) => {
    queries.push({ sql: String(sql).replace(/\s+/g, " ").trim(), params });
    if (/COUNT\(\*\)/i.test(sql)) return [[{ total: 0 }]];
    return [[]];
  };
});

const reqFor = (context) => ({ query: {}, context, user: { userId: context.userId ?? 7 } });
const resFor = () => {
  const res = { statusCode: 200, payload: null };
  res.status = (c) => ((res.statusCode = c), res);
  res.json = (p) => ((res.payload = p), res);
  return res;
};

test("company-less rows are no longer admitted to everybody", async () => {
  /*
   * The exact regression. `OR a.company_id IS NULL` with nothing qualifying it
   * is what leaked one tenant's sign-in trail to another.
   */
  await listAuditLogs(reqFor({ companyId: 42, branchId: 1, isSystemAdmin: false }), resFor());

  for (const q of queries) {
    assert.doesNotMatch(
      q.sql,
      /OR a\.company_id IS NULL\s*\)/,
      "an unqualified company-less clause is back in the query"
    );
  }
});

test("a company-less row is admitted only for its own staff", async () => {
  await listAuditLogs(reqFor({ companyId: 42, branchId: 1, isSystemAdmin: false }), resFor());
  const [first] = queries;

  assert.match(first.sql, /a\.company_id = \?/);
  assert.match(first.sql, /EXISTS \( SELECT 1 FROM user_company_access uca/);
  assert.match(first.sql, /uca\.company_id = \?/);
  assert.match(first.sql, /uca\.status = 'active'/);
  // The company is bound twice: once for its own rows, once for membership.
  assert.equal(first.params[0], 42);
  assert.equal(first.params[1], 42);
});

test("a failed sign-in is matched through the account it was aimed at", async () => {
  // There is no session yet, so the row carries no user_id — only the account
  // in entity_id. Without this, a company never sees attacks on its own staff.
  await listAuditLogs(reqFor({ companyId: 42, branchId: 1, isSystemAdmin: false }), resFor());

  assert.match(queries[0].sql, /COALESCE\( a\.user_id, CASE WHEN a\.entity_type = 'user'/);
  assert.match(queries[0].sql, /CAST\(NULLIF\(a\.entity_id, ''\) AS UNSIGNED\)/);
});

test("an attempt on an address belonging to nobody is kept from tenants", async () => {
  // It names no company and no account. Showing it to a tenant would tell them
  // which addresses somebody is guessing at across the whole installation.
  await listAuditLogs(reqFor({ companyId: 42, branchId: 1, isSystemAdmin: false }), resFor());
  assert.doesNotMatch(queries[0].sql, /a\.user_id IS NULL/);
});

test("the operator of the installation can still see those attempts", async () => {
  // Otherwise "somebody is walking a list of addresses" becomes invisible to
  // the only person entitled to watch the whole platform.
  await listAuditLogs(reqFor({ companyId: 1, branchId: 1, isSystemAdmin: true }), resFor());
  assert.match(queries[0].sql, /a\.user_id IS NULL/);
});

test("the count and the page use the same filter", async () => {
  /*
   * They are built from one string, and they must stay that way: a count that
   * admits more rows than the page reports a total the reader can never reach,
   * and which silently measures other tenants' data.
   */
  await listAuditLogs(reqFor({ companyId: 42, branchId: 1, isSystemAdmin: false }), resFor());
  assert.equal(queries.length, 2);

  const [count, page] = queries;
  const clause = (sql) => sql.slice(sql.indexOf("WHERE"));
  assert.equal(
    clause(count.sql).replace(/ORDER BY[\s\S]*$/, "").trim(),
    clause(page.sql).replace(/ORDER BY[\s\S]*$/, "").trim()
  );
  assert.deepEqual(count.params, page.params);
});

test("filters still bind in the right order after the extra company parameter", async () => {
  // The base clause now binds the company twice. A filter appended after it
  // would land on the wrong placeholder if the parameter list drifted.
  const req = reqFor({ companyId: 42, branchId: 1, isSystemAdmin: false });
  req.query = { module: "auth", action: "sign_in", search: "ana" };
  await listAuditLogs(req, resFor());

  const { params } = queries[0];
  assert.equal(params[0], 42);
  assert.equal(params[1], 42);
  assert.equal(params[2], "auth");
  assert.equal(params[3], "sign_in");
  assert.deepEqual(params.slice(4), ["%ana%", "%ana%", "%ana%"]);
});
