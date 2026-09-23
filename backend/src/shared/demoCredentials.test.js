import "../config/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import { findDemoCredentials, isProduction, isDemoPin, enforceDemoCredentialPolicy } from "./demoCredentials.js";

/**
 * Refusing to hold real data behind a published password.
 *
 * The rotation script has existed for a while; nothing checked whether anybody
 * ran it. A go-live checklist is a piece of paper, and the one thing certain
 * about the day a system goes live is that something on the list gets missed.
 */

const runnerFor = ({ users = [], drivers = [] }) => ({
  execute: async (sql) => [sql.includes("FROM users") ? users : drivers],
});

const collectingLog = () => {
  const lines = [];
  return { lines, log: (m) => lines.push(String(m)), error: (m) => lines.push(String(m)) };
};

test("a staff account still using the published password is found", async () => {
  const runner = runnerFor({
    users: [{ user_id: 1, email: "admin@astreablue.com", password_hash: await bcrypt.hash("admin123", 10) }],
  });
  const found = await findDemoCredentials(runner);
  assert.deepEqual(found.staff, ["admin@astreablue.com"]);
});

test("a driver still using the published PIN is found", async () => {
  const runner = runnerFor({
    drivers: [{ driver_id: 1, employee_no: "DRV-001", pin_hash: await bcrypt.hash("1234", 10) }],
  });
  const found = await findDemoCredentials(runner);
  assert.deepEqual(found.drivers, ["DRV-001"]);
});

test("real credentials are not mistaken for demo ones", async () => {
  // The check must be worth trusting in the direction that blocks a deploy.
  const runner = runnerFor({
    users: [{ user_id: 1, email: "real@example.com", password_hash: await bcrypt.hash("a-real-passphrase", 10) }],
    drivers: [{ driver_id: 1, employee_no: "DRV-009", pin_hash: await bcrypt.hash("8241", 10) }],
  });
  const found = await findDemoCredentials(runner);
  assert.deepEqual(found.staff, []);
  assert.deepEqual(found.drivers, []);
});

test("an account with no hash at all is not reported as a demo account", async () => {
  // A null password_hash compares false rather than throwing, and reporting it
  // would block a deploy over a different problem entirely.
  const runner = runnerFor({ users: [{ user_id: 1, email: "x@example.com", password_hash: null }] });
  assert.deepEqual((await findDemoCredentials(runner)).staff, []);
});

test("a development machine is left alone", async () => {
  // Demo credentials are the point of a demo. This must not make the system
  // unusable for the thing it ships to do.
  assert.equal(isProduction({ NODE_ENV: "development" }), false);
  assert.equal(isProduction({}), false);

  let exited = false;
  const result = await enforceDemoCredentialPolicy({
    env: { NODE_ENV: "development" },
    exit: () => { exited = true; },
    log: collectingLog(),
  });
  assert.equal(result.checked, false);
  assert.equal(exited, false, "a development machine was stopped");
});

test("production is recognised from either signal", () => {
  assert.equal(isProduction({ NODE_ENV: "production" }), true);
  // Railway sets this and not always NODE_ENV, and a system holding real trips
  // is production whether or not a variable says so.
  assert.equal(isProduction({ RAILWAY_ENVIRONMENT: "production" }), true);
});

test("a check that cannot run does not take down a healthy system", async () => {
  /*
   * The database being briefly unreachable is a different problem, and
   * refusing to start over it would turn a blip into an outage on the strength
   * of a question that was never answered.
   */
  const logger = collectingLog();
  let exited = false;
  const result = await enforceDemoCredentialPolicy({
    env: { NODE_ENV: "production" },
    exit: () => { exited = true; },
    log: logger,
    find: async () => { throw new Error("database unreachable"); },
  });

  assert.equal(exited, false, "an unanswerable check stopped a healthy system");
  assert.equal(result.checked, false);
  assert.ok(logger.lines.some((l) => /Could not verify/.test(l)));
});

test("production with a demo password still in use is stopped", async () => {
  const logger = collectingLog();
  let code = null;
  await enforceDemoCredentialPolicy({
    env: { NODE_ENV: "production" },
    exit: (c) => { code = c; },
    log: logger,
    find: async () => ({ staff: ["admin@astreablue.com"], drivers: ["DRV-001"] }),
  });

  assert.equal(code, 1, "production kept serving with a published password");
  const said = logger.lines.join("\n");
  assert.match(said, /REFUSING TO START/);
  // The message has to carry the fix, not just the complaint.
  assert.match(said, /creds:rotate/);
  assert.match(said, /admin@astreablue\.com/);
  assert.match(said, /DRV-001/);
});

test("production with real credentials is allowed to start", async () => {
  const logger = collectingLog();
  let exited = false;
  const result = await enforceDemoCredentialPolicy({
    env: { NODE_ENV: "production" },
    exit: () => { exited = true; },
    log: logger,
    find: async () => ({ staff: [], drivers: [] }),
  });

  assert.equal(exited, false);
  assert.equal(result.checked, true);
  assert.ok(logger.lines.some((l) => /none in use/.test(l)));
});

/*
 * The distinction that cost a day of production downtime.
 *
 * The first version of this treated a demonstration staff password and a
 * demonstration driver PIN as the same emergency, and refused to start for
 * either. A single seeded driver then held a whole fleet's dispatch offline
 * while ten real drivers and every trip in the system waited on a PIN nobody
 * was using. A staff password opens a company's whole operation; a driver PIN
 * opens that driver's own trips, and a Driver App token cannot reach a staff
 * route. They are not the same, and these pin that they are treated
 * differently.
 */

test("a demo driver PIN alone does not take the system down", async () => {
  const logger = collectingLog();
  let code = null;
  await enforceDemoCredentialPolicy({
    env: { NODE_ENV: "production" },
    exit: (c) => { code = c; },
    log: logger,
    find: async () => ({ staff: [], drivers: ["DRV-001"] }),
  });

  assert.equal(code, null, "one seeded driver stopped the whole server again");
  const said = logger.lines.join("\n");
  assert.match(said, /DRIVER APP SIGN-IN BLOCKED/);
  assert.match(said, /DRV-001/);
  assert.doesNotMatch(said, /REFUSING TO START/);
});

test("a demo staff password still stops it, and says so on its own terms", async () => {
  // The exposure here is the whole operation, and there is no safe way to keep
  // serving while it is live.
  const logger = collectingLog();
  let code = null;
  await enforceDemoCredentialPolicy({
    env: { NODE_ENV: "production" },
    exit: (c) => { code = c; },
    log: logger,
    find: async () => ({ staff: ["admin@astreablue.com"], drivers: [] }),
  });

  assert.equal(code, 1);
  assert.match(logger.lines.join("\n"), /REFUSING TO START/);
});

test("both at once: the drivers are named, and it still stops for the staff account", async () => {
  const logger = collectingLog();
  let code = null;
  await enforceDemoCredentialPolicy({
    env: { NODE_ENV: "production" },
    exit: (c) => { code = c; },
    log: logger,
    find: async () => ({ staff: ["admin@astreablue.com"], drivers: ["DRV-001"] }),
  });

  assert.equal(code, 1);
  const said = logger.lines.join("\n");
  assert.match(said, /DRIVER APP SIGN-IN BLOCKED/);
  assert.match(said, /REFUSING TO START/);
});

test("the published PIN is recognised whatever it is wrapped in", () => {
  // It arrives from a phone keypad, so it may carry whitespace.
  assert.equal(isDemoPin("1234"), true);
  assert.equal(isDemoPin(" 1234 "), true);
  assert.equal(isDemoPin(1234), true);
  assert.equal(isDemoPin("123456"), false);
  assert.equal(isDemoPin("4321"), false);
  assert.equal(isDemoPin(""), false);
  assert.equal(isDemoPin(null), false);
});
