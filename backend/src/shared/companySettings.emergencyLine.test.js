import "../config/env.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import db from "../config/db.js";
import {
  DEMO_EMERGENCY_LINE,
  normaliseEmergencyLine,
  emergencyLineView,
  savedEmergencyLine,
  emergencyLineFor,
  settingsFor,
} from "./companySettings.js";

after(async () => { await db.end(); });

test("phone numbers as people write them are accepted and tidied", () => {
  assert.equal(normaliseEmergencyLine("+63 917 123 4567"), "+63 917 123 4567");
  assert.equal(normaliseEmergencyLine("(082) 224-1234"), "(082) 224-1234");
  assert.equal(normaliseEmergencyLine(" 0917   123  4567 "), "0917 123 4567");
  assert.equal(normaliseEmergencyLine("911"), "911");
});

test("an empty value clears the line; anything that is not a number is refused", () => {
  assert.equal(normaliseEmergencyLine(""), "");
  assert.equal(normaliseEmergencyLine("   "), "");
  assert.equal(normaliseEmergencyLine(null), "");
  for (const bad of ["12", "abc", "0917-ABC-1234", "++63 917", "0917+123", "+63 917 123 4567 8901 2", "1234567890123456"]) {
    assert.equal(normaliseEmergencyLine(bad), null, `accepted ${bad}`);
  }
});

test("the demo number is offered only off production, and always labelled", () => {
  assert.deepEqual(emergencyLineView(null, { NODE_ENV: "development" }), { number: DEMO_EMERGENCY_LINE, isDemo: true });
  assert.deepEqual(emergencyLineView(null, { NODE_ENV: "production" }), { number: null, isDemo: false });
  assert.deepEqual(emergencyLineView(null, { RAILWAY_ENVIRONMENT: "production" }), { number: null, isDemo: false });
  assert.deepEqual(emergencyLineView("911", { NODE_ENV: "production" }), { number: "911", isDemo: false });
  assert.deepEqual(emergencyLineView("911", { NODE_ENV: "development" }), { number: "911", isDemo: false });
});

test("a database without migration 058 reads as no line saved, not as an error", async () => {
  const runner = {
    execute: async () => { throw Object.assign(new Error("Unknown column"), { code: "ER_BAD_FIELD_ERROR" }); },
  };
  assert.equal(await savedEmergencyLine(1, runner), null);
  assert.deepEqual(await emergencyLineFor(1, { runner, env: { NODE_ENV: "production" } }), { number: null, isDemo: false });
});

test("other database errors are not hidden", async () => {
  const runner = { execute: async () => { throw Object.assign(new Error("gone"), { code: "PROTOCOL_CONNECTION_LOST" }); } };
  await assert.rejects(() => savedEmergencyLine(1, runner), /gone/);
});

test("a bad number edited straight into the database never reaches a Call button", async () => {
  const runner = { execute: async () => [[{ emergency_line: "call the boss" }]] };
  assert.equal(await savedEmergencyLine(1, runner), null);
});

test("trip numbering does not read the emergency line, so it works before migration 058", async () => {
  const seen = [];
  const runner = {
    execute: async (sql) => {
      seen.push(sql);
      return [[{ trip_prefix: "DVO", location_retention_months: 12 }]];
    },
  };
  assert.equal((await settingsFor(1, runner)).tripPrefix, "DVO");
  assert.ok(seen.every((sql) => !/emergency_line/.test(sql)));
});
