import "../../config/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import db from "../../config/db.js";
import { current, accept, history } from "./agreement.controller.js";
import { VERSION } from "./agreement.content.js";

/**
 * Accepting the Terms of Service and Data Privacy Policy.
 *
 * This is a consent record under the Data Privacy Act, so what these guard is
 * not the wording but the integrity of the record: that acceptance is measured
 * against the version actually published, that a client cannot name the version
 * it is accepting, and that accepting twice does not become two consents.
 */

async function withDb(handler, fn) {
  const real = db.execute;
  const calls = [];
  db.execute = async (sql, params) => {
    calls.push({ sql, params });
    return handler(sql, params);
  };
  try {
    return await fn(calls);
  } finally {
    db.execute = real;
  }
}

function recorder() {
  const out = {};
  out.res = {
    status(code) { out.statusCode = code; return this; },
    json(value) { out.body = value; return this; },
  };
  return out;
}

const req = (extra = {}) => ({
  user: { userId: 42 },
  headers: {},
  ip: "203.0.113.9",
  socket: { remoteAddress: "203.0.113.9" },
  ...extra,
});

test("the document and the user's acceptance arrive together", async () => {
  // The app has to decide whether to show the gate before rendering anything.
  // Two requests would flash the application behind the gate on a slow link.
  const r = recorder();
  await withDb(() => [[{ accepted_at: new Date("2026-06-30T01:00:00Z") }]],
    () => current(req(), r.res));

  assert.equal(r.body.data.accepted, true);
  assert.ok(r.body.data.sections.length > 0, "the text must travel with the state");
  assert.equal(r.body.data.version, VERSION);
});

test("a user who has never accepted is reported as not accepted", async () => {
  const r = recorder();
  await withDb(() => [[undefined]], () => current(req(), r.res));

  assert.equal(r.body.data.accepted, false);
  assert.equal(r.body.data.acceptedAt, null);
});

test("acceptance is judged against the version published now", async () => {
  // Section 2.2: a revised Agreement has to be accepted again. Asking only
  // whether the user ever accepted anything would carry old consent forward,
  // which is the one thing the version number exists to prevent.
  const r = recorder();
  const calls = await withDb(() => [[undefined]], async (calls) => {
    await current(req(), r.res);
    return calls;
  });

  assert.match(calls[0].sql, /version = \?/);
  assert.deepEqual(calls[0].params, [42, VERSION]);
});

test("the accepted version comes from the server, never from the request", async () => {
  // A client that could name the version could accept one it was never shown,
  // and the consent record would be worthless.
  const r = recorder();
  const calls = await withDb((sql) => {
    if (sql.startsWith("INSERT INTO agreement_acceptances")) return [{ insertId: 1 }];
    return [[{ accepted_at: new Date() }]];
  }, async (calls) => {
    await accept(req({ body: { version: "99.9" } }), r.res);
    return calls;
  });

  const insert = calls.find((c) => c.sql.startsWith("INSERT INTO agreement_acceptances"));
  assert.equal(insert.params[1], VERSION, "must record the published version");
  assert.notEqual(insert.params[1], "99.9");
});

test("accepting twice stays one consent", async () => {
  const r = recorder();
  const calls = await withDb((sql) => {
    if (sql.startsWith("INSERT INTO agreement_acceptances")) return [{ affectedRows: 0 }];
    return [[{ accepted_at: new Date() }]];
  }, async (calls) => {
    await accept(req(), r.res);
    return calls;
  });

  const insert = calls.find((c) => c.sql.startsWith("INSERT INTO agreement_acceptances"));
  assert.match(insert.sql, /ON DUPLICATE KEY UPDATE/);
  assert.equal(r.body.data.accepted, true);
});

test("the address behind a proxy is recorded, not the proxy", async () => {
  // Railway terminates TLS in front of the app. Without this every consent
  // record would store the load balancer and say nothing worth keeping.
  const r = recorder();
  const calls = await withDb((sql) => {
    if (sql.startsWith("INSERT INTO agreement_acceptances")) return [{ insertId: 1 }];
    return [[{ accepted_at: new Date() }]];
  }, async (calls) => {
    await accept(
      req({ headers: { "x-forwarded-for": "112.198.1.5, 10.0.0.1", "user-agent": "Chrome" } }),
      r.res
    );
    return calls;
  });

  const insert = calls.find((c) => c.sql.startsWith("INSERT INTO agreement_acceptances"));
  assert.equal(insert.params[2], "112.198.1.5");
  assert.equal(insert.params[3], "Chrome");
});

test("an absurd user agent cannot overflow its column", async () => {
  const r = recorder();
  const calls = await withDb((sql) => {
    if (sql.startsWith("INSERT INTO agreement_acceptances")) return [{ insertId: 1 }];
    return [[{ accepted_at: new Date() }]];
  }, async (calls) => {
    await accept(req({ headers: { "user-agent": "x".repeat(900) } }), r.res);
    return calls;
  });

  const insert = calls.find((c) => c.sql.startsWith("INSERT INTO agreement_acceptances"));
  assert.equal(insert.params[3].length, 255);
});

test("a user can see everything they have consented to", async () => {
  // Section 4.7 gives them the right to ask, and an auditor asks the same.
  const r = recorder();
  await withDb(() => [[
    { version: "1.0", accepted_at: new Date("2026-06-30T01:00:00Z") },
  ]], () => history(req(), r.res));

  assert.equal(r.body.data.length, 1);
  assert.equal(r.body.data[0].version, "1.0");
});
