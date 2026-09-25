import { test } from "node:test";
import assert from "node:assert/strict";
import { productionDatabaseReason, refuseProductionDatabase } from "./productionDatabaseGuard.js";

/**
 * Development tooling must not write to production.
 *
 * The case this exists for is not a misconfigured server: it is a developer
 * who pointed a local .env at the production database for a one-off command
 * and then ran the test suite or a demo reset. That process does not look like
 * production — no RAILWAY_ENVIRONMENT, NODE_ENV=development — but the database
 * it points at does.
 */

const local = { NODE_ENV: "development", DB_HOST: "127.0.0.1", DB_NAME: "trackify" };

test("a local development database is allowed", () => {
  assert.equal(productionDatabaseReason(local), null);
  assert.equal(productionDatabaseReason({ ...local, DB_HOST: "localhost" }), null);
});

test("a local .env pointed at Railway's public proxy is refused", () => {
  // The realistic case: NODE_ENV says development, the host says otherwise.
  const env = { ...local, DB_HOST: "monorail.proxy.rlwy.net" };
  assert.match(productionDatabaseReason(env), /Railway database/);
});

test("Railway's internal host and the default database name are refused", () => {
  assert.ok(productionDatabaseReason({ ...local, DB_HOST: "mysql.railway.internal" }));
  assert.ok(productionDatabaseReason({ ...local, DB_NAME: "railway" }));
});

test("Railway's MYSQL* variables are read the same way the app reads them", () => {
  assert.ok(productionDatabaseReason({ NODE_ENV: "development", MYSQLHOST: "x.proxy.rlwy.net" }));
  assert.ok(productionDatabaseReason({ NODE_ENV: "development", MYSQLDATABASE: "railway" }));
});

test("a process configured as production is refused whatever the database", () => {
  assert.ok(productionDatabaseReason({ ...local, NODE_ENV: "production" }));
  assert.ok(productionDatabaseReason({ ...local, RAILWAY_ENVIRONMENT: "production" }));
});

test("a lookalike host is not mistaken for Railway", () => {
  // Only the real suffixes count; a local machine named "railway" is not one.
  assert.equal(productionDatabaseReason({ ...local, DB_HOST: "notrlwy.net.example" }), null);
  assert.equal(productionDatabaseReason({ ...local, DB_HOST: "railway" }), null);
});

test("the override has to be spelled out", () => {
  const env = { ...local, DB_NAME: "railway" };
  assert.ok(productionDatabaseReason({ ...env, ALLOW_WRITES_TO_THIS_DATABASE: "true" }));
  assert.ok(productionDatabaseReason({ ...env, ALLOW_WRITES_TO_THIS_DATABASE: "1" }));
  assert.equal(productionDatabaseReason({ ...env, ALLOW_WRITES_TO_THIS_DATABASE: "yes" }), null);
});

test("refusing stops the process with a non-zero exit and says why", () => {
  // Loud on purpose: a test suite that quietly skipped would look green.
  let code = null;
  const lines = [];
  const refused = refuseProductionDatabase("the test suite", {
    env: { ...local, DB_NAME: "railway" },
    exit: (c) => { code = c; },
    log: (m) => lines.push(m),
  });
  assert.equal(refused, true);
  assert.equal(code, 1);
  assert.match(lines.join("\n"), /REFUSING TO RUN THE TEST SUITE/);
  assert.match(lines.join("\n"), /ALLOW_WRITES_TO_THIS_DATABASE=yes/);
});

test("a safe database is let through without a word", () => {
  let code = null;
  const refused = refuseProductionDatabase("anything", { env: local, exit: (c) => { code = c; }, log: () => {} });
  assert.equal(refused, false);
  assert.equal(code, null);
});
