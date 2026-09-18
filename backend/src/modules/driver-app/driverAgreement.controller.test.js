import "../../config/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import db from "../../config/db.js";
import { current, accept } from "./driverAgreement.controller.js";
import { VERSION } from "../agreement/agreement.content.js";

/**
 * A driver accepting the Terms of Service and Data Privacy Policy.
 *
 * This exists because until it did, a driver who only used the phone could not
 * accept the Agreement at all, while section 4.3 named consent as the legal
 * basis for collecting their location. What these guard is not the wording but
 * the integrity of the consent record: that it is measured against the version
 * actually published, that a client cannot name the version it is accepting,
 * that it is keyed to the signed-in driver and nobody else, and that accepting
 * twice does not become two consents.
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
  driver: { driverId: 7, companyId: 1 },
  headers: {},
  socket: {},
  body: {},
  ...extra,
});

test("a driver who has not accepted gets the document and accepted:false", async () => {
  await withDb(
    () => [[]],
    async () => {
      const out = recorder();
      await current(req(), out.res);

      assert.equal(out.body.success, true);
      assert.equal(out.body.data.accepted, false);
      assert.equal(out.body.data.version, VERSION);
      // The gate has to render the text without a second request.
      assert.ok(out.body.data.sections.length > 0);
      assert.ok(out.body.data.acceptanceStatement);
    }
  );
});

test("acceptance is measured against the version published now, not any version", async () => {
  // Section 2.2: a revised Agreement has to be accepted again. Asking only
  // "has this driver ever accepted something" would carry old consent forward
  // silently, which is the one thing the version number exists to prevent.
  await withDb(
    () => [[{ accepted_at: "2026-09-18 08:00:00" }]],
    async (calls) => {
      const out = recorder();
      await current(req(), out.res);

      assert.equal(out.body.data.accepted, true);
      assert.deepEqual(calls[0].params, [7, VERSION]);
    }
  );
});

test("the acceptance is keyed to the signed-in driver, not to anything the client sends", async () => {
  await withDb(
    (sql) => (sql.startsWith("INSERT") ? [{ insertId: 1 }] : [[{ accepted_at: "now" }]]),
    async (calls) => {
      const out = recorder();
      await accept(
        req({
          driver: { driverId: 7, companyId: 1 },
          body: { driverId: 999, version: "0.1" },
          headers: { "x-forwarded-for": "112.198.1.5, 10.0.0.1", "user-agent": "Trackify Driver" },
        }),
        out.res
      );

      const insert = calls.find((c) => c.sql.includes("INSERT INTO driver_agreement_acceptances"));
      // driver 7 from the token, VERSION from the server: neither the id nor
      // the version in the request body reaches the record.
      assert.deepEqual(insert.params, [7, VERSION, "112.198.1.5", "Trackify Driver"]);
      assert.equal(out.body.data.version, VERSION);
    }
  );
});

test("the client-facing address is the phone's, not the proxy's", async () => {
  // Railway terminates TLS in front of the app, so without reading the
  // forwarded header every driver's consent would record the load balancer.
  await withDb(
    (sql) => (sql.startsWith("INSERT") ? [{ insertId: 1 }] : [[{ accepted_at: "now" }]]),
    async (calls) => {
      const out = recorder();
      await accept(req({ headers: {}, socket: { remoteAddress: "10.1.1.9" } }), out.res);
      const insert = calls.find((c) => c.sql.includes("INSERT INTO driver_agreement_acceptances"));
      assert.equal(insert.params[2], "10.1.1.9");
      assert.equal(insert.params[3], null, "no user-agent header means no value, not the string 'undefined'");
    }
  );
});

test("accepting twice is one consent", async () => {
  await withDb(
    (sql) => (sql.startsWith("INSERT") ? [{ insertId: 1 }] : [[{ accepted_at: "now" }]]),
    async (calls) => {
      const out = recorder();
      await accept(req(), out.res);
      const insert = calls.find((c) => c.sql.includes("INSERT INTO driver_agreement_acceptances"));
      assert.match(
        insert.sql,
        /ON DUPLICATE KEY UPDATE/,
        "A second tap on Accept must not write a second consent row."
      );
      assert.equal(out.body.data.accepted, true);
    }
  );
});

test("a driver's consent is recorded in its own table, never against a user id", async () => {
  // A driver has no users row. Writing this into agreement_acceptances would
  // fail its foreign key, or worse, attach a driver's consent to whichever
  // staff account happened to share the number.
  await withDb(
    (sql) => (sql.startsWith("INSERT") ? [{ insertId: 1 }] : [[{ accepted_at: "now" }]]),
    async (calls) => {
      await accept(req(), recorder().res);
      for (const call of calls) {
        assert.doesNotMatch(call.sql, /INSERT INTO agreement_acceptances/);
        assert.doesNotMatch(call.sql, /\buser_id\b/);
      }
    }
  );
});
