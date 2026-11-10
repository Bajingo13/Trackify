import "../config/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { up } from "../../migrations/064_arrival_radius.js";
import {
  DEFAULT_ARRIVAL_RADIUS_M,
  arrivalRadiusFor,
  normaliseArrivalRadius,
} from "./companySettings.js";

test("arrival radius validation is bounded and exact", () => {
  assert.equal(normaliseArrivalRadius(50), 50);
  assert.equal(normaliseArrivalRadius("150"), 150);
  assert.equal(normaliseArrivalRadius(1000), 1000);
  for (const bad of [49, 1001, 150.5, null, "near"]) assert.equal(normaliseArrivalRadius(bad), null);
});

test("a database before migration 064 keeps the historical radius", async () => {
  const runner = { execute: async () => { throw Object.assign(new Error("unknown"), { code: "ER_BAD_FIELD_ERROR" }); } };
  assert.equal(await arrivalRadiusFor(1, runner), DEFAULT_ARRIVAL_RADIUS_M);
});

test("migration 064 is additive, defaults to 150, and is idempotent", async () => {
  let exists = false;
  const statements = [];
  const conn = {
    async query(sql) {
      const text = String(sql).replace(/\s+/g, " ").trim();
      statements.push(text);
      if (text.includes("information_schema.COLUMNS")) return [exists ? [{ COLUMN_NAME: "arrival_radius_m" }] : []];
      if (text.startsWith("ALTER TABLE")) exists = true;
      return [[]];
    },
  };
  await up(conn);
  await up(conn);
  const alters = statements.filter((s) => s.startsWith("ALTER TABLE"));
  assert.equal(alters.length, 1);
  assert.match(alters[0], /SMALLINT UNSIGNED NOT NULL DEFAULT 150/);
});
