import "../config/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULTS,
  normalisePrefix,
  normaliseRetention,
  settingsFor,
  MAX_RETENTION_MONTHS,
} from "./companySettings.js";
import { retentionPlan, pruneLocationTrail, RETENTION_MONTHS } from "./locationRetention.js";

/**
 * A setting is only a setting if something obeys it.
 *
 * These pin the two company settings to the code that reads them: the ticket
 * prefix to the number a new trip gets, and the retention period to what the
 * nightly sweep deletes. Without that a settings screen is a form that stores
 * values nothing consults — which looks like it works, which is the worst way
 * for it to be broken.
 */

const runnerFor = (rows) => ({
  calls: [],
  async execute(sql, params) {
    this.calls.push({ sql: String(sql).replace(/\s+/g, " ").trim(), params });
    if (/^SELECT COUNT/i.test(sql)) return [[{ eligible: 0 }]];
    return [rows];
  },
});

test("a company that never opened the screen keeps the behaviour it had", async () => {
  // Nothing may change underneath an operator who was never asked.
  const settings = await settingsFor(7, runnerFor([]));
  assert.deepEqual(settings, { ...DEFAULTS });
});

test("a prefix is accepted in the shape people type into spreadsheets", () => {
  assert.equal(normalisePrefix("dvo"), "DVO");
  assert.equal(normalisePrefix("  tt-a "), "TT-A");
  for (const bad of ["", "   ", "9TT", "TT TICKET", "TT/2026", "TOOLONGPREFIX", null, "—"]) {
    assert.equal(normalisePrefix(bad), null, `accepted ${JSON.stringify(bad)}`);
  }
});

test("a retention period cannot be set to something the policy could not defend", () => {
  assert.equal(normaliseRetention(18), 18);
  assert.equal(normaliseRetention("24"), 24);
  for (const bad of [0, -1, 1.5, MAX_RETENTION_MONTHS + 1, "soon", null, NaN]) {
    assert.equal(normaliseRetention(bad), null, `accepted ${JSON.stringify(bad)}`);
  }
});

test("a junk value edited straight into the table does not reach every future ticket", async () => {
  // Guarded on the way out as well as in: the row is not the only way in.
  const settings = await settingsFor(1, runnerFor([{ trip_prefix: "!!", location_retention_months: 0 }]));
  assert.deepEqual(settings, { ...DEFAULTS });
});

test("each company's trail is swept on its own period, and nobody else's", async () => {
  const runner = runnerFor([
    { company_id: 1, months: 18 },
    { company_id: 2, months: 6 },
    { company_id: 5, months: 18 },
  ]);
  const plan = await retentionPlan(runner);

  assert.deepEqual(
    plan.map((s) => [s.months, s.companyIds ?? `except ${s.exceptCompanyIds}`]),
    [
      [18, [1, 5]],
      [6, [2]],
      [RETENTION_MONTHS, "except 1,2,5"],
    ]
  );
});

test("the default sweep skips the companies that chose, so a longer period is not overridden", async () => {
  const runner = runnerFor([{ company_id: 3, months: 24 }]);
  const [, fallback] = await retentionPlan(runner);
  await pruneLocationTrail({ ...fallback, runner });

  const count = runner.calls.at(-1);
  assert.match(count.sql, /company_id NOT IN \(\?\)/);
  assert.deepEqual(count.params, [3]);
  assert.match(count.sql, new RegExp(`INTERVAL ${RETENTION_MONTHS} MONTH`));
});

test("a sweep scoped to no companies deletes nothing at all", async () => {
  /*
   * The dangerous reading of an empty list is "no restriction", which would
   * sweep every company on one company's period. It has to mean what it says.
   */
  const runner = runnerFor([]);
  const result = await pruneLocationTrail({ companyIds: [], runner, months: 1 });

  assert.equal(result.deleted, 0);
  assert.equal(runner.calls.length, 0, "an unscoped query reached the database");
});
