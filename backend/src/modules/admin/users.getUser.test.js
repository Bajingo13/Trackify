import "../../config/env.js";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import db from "../../config/db.js";
import { getUser } from "./users.controller.js";

/**
 * A person can work for more than one company. Their profile used to come back
 * with access rows and roles for every company they belonged to, so a client's
 * administrator could read other clients' names, branches and roles off it.
 * A company sees its own rows; only the installation's operator sees across.
 */

const real = db.execute.bind(db);
after(async () => {
  db.execute = real;
  await db.end();
});

let calls = [];
beforeEach(() => {
  calls = [];
  db.execute = async (sql, params = []) => {
    const text = String(sql).replace(/\s+/g, " ").trim();
    calls.push({ text, params });
    if (/FROM users u JOIN user_company_access/i.test(text)) return [[{ user_id: 9, email: "x@example.test" }]];
    return [[]];
  };
});

const run = async (context) => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => ((res.statusCode = c), res);
  res.json = (b) => ((res.body = b), res);
  await getUser({ params: { id: "9" }, context }, res);
  return res;
};

const find = (pattern) => calls.find((c) => pattern.test(c.text));

test("a company administrator gets only this company's access rows", async () => {
  await run({ companyId: 42, isSystemAdmin: false });
  const access = find(/FROM user_company_access uca JOIN companies/);
  assert.match(access.text, /uca\.user_id = \? AND uca\.company_id = \?/);
  assert.deepEqual(access.params, [9, 42]);
});

test("and only this company's roles", async () => {
  await run({ companyId: 42, isSystemAdmin: false });
  const roles = find(/FROM user_roles ur JOIN roles r/);
  assert.match(roles.text, /ur\.user_id = \? AND ur\.company_id = \?/);
  assert.deepEqual(roles.params, [9, 42]);
});

test("the installation's operator still sees every company", async () => {
  await run({ companyId: 1, isSystemAdmin: true });
  const access = find(/FROM user_company_access uca JOIN companies/);
  const roles = find(/FROM user_roles ur JOIN roles r/);
  assert.doesNotMatch(access.text, /uca\.company_id = \?/);
  assert.doesNotMatch(roles.text, /ur\.company_id = \?/);
  assert.deepEqual(access.params, [9]);
});
