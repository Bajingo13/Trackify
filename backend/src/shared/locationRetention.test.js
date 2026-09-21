import "../config/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { pruneLocationTrail, scheduleLocationRetention, RETENTION_MONTHS } from "./locationRetention.js";

/**
 * Keeping the retention promise.
 *
 * The privacy policy states that the location trail is kept for twelve months
 * and then deleted. Nothing deleted it — the promise was written before the
 * code that keeps it, which makes it the same kind of false claim this project
 * has spent days removing from the Terms, except in a document shown to a
 * regulator.
 *
 * What these guard is the shape of the deletion: that it takes the trail and
 * not the trip, that it cannot be pointed at a nonsense period, and that a
 * failure to prune never takes down a system that is otherwise working.
 */

const runnerFor = ({ eligible = 0, perBatch = [] } = {}) => {
  const statements = [];
  let batchIndex = 0;
  return {
    statements,
    execute: async (sql) => {
      statements.push(String(sql).replace(/\s+/g, " ").trim());
      if (/^SELECT COUNT/i.test(sql)) return [[{ eligible }]];
      const affectedRows = perBatch[batchIndex] ?? 0;
      batchIndex += 1;
      return [{ affectedRows }];
    },
  };
};

test("only the trail is deleted, never the trip", async () => {
  /*
   * The trip record is an accounting record kept for ten years; the trail
   * underneath is a record of a person's movements. Deleting the wrong one
   * destroys the proof of a delivery, which is the opposite of the intent.
   */
  const runner = runnerFor({ eligible: 10, perBatch: [10] });
  await pruneLocationTrail({ runner, months: 12 });

  for (const sql of runner.statements) {
    assert.match(sql, /trip_tracking_points/);
    assert.doesNotMatch(sql, /trip_tickets|trip_stops|trip_pod|trip_expenses/);
  }
});

test("nothing old enough means nothing is deleted", async () => {
  // A young system must not issue a DELETE at all — an empty sweep should be
  // free, because this runs every day forever.
  const runner = runnerFor({ eligible: 0 });
  const result = await pruneLocationTrail({ runner });

  assert.equal(result.deleted, 0);
  assert.equal(runner.statements.filter((s) => /^DELETE/i.test(s)).length, 0);
});

test("a dry run reports what would go without touching it", async () => {
  const runner = runnerFor({ eligible: 4321 });
  const result = await pruneLocationTrail({ runner, dryRun: true });

  assert.equal(result.eligible, 4321);
  assert.equal(result.deleted, 0);
  assert.equal(runner.statements.filter((s) => /^DELETE/i.test(s)).length, 0);
});

test("a large trail is removed in batches rather than one locking sweep", async () => {
  // A year of points across a fleet is a lot of rows. One unbounded DELETE
  // holds locks long enough to stall dispatch while it runs.
  const runner = runnerFor({ eligible: 12, perBatch: [5, 5, 2] });
  const result = await pruneLocationTrail({ runner, batch: 5 });

  assert.equal(result.deleted, 12);
  const deletes = runner.statements.filter((s) => /^DELETE/i.test(s));
  assert.equal(deletes.length, 3, "it did not stop when a batch came back short");
  for (const sql of deletes) assert.match(sql, /LIMIT 5/);
});

test("the cutoff is the retention period, expressed in the query", async () => {
  const runner = runnerFor({ eligible: 0 });
  await pruneLocationTrail({ runner, months: 18 });
  assert.match(runner.statements[0], /INTERVAL 18 MONTH/);
});

test("a nonsense retention period is refused rather than guessed at", async () => {
  // Interpolated into SQL because MySQL will not bind inside an INTERVAL, so
  // this has to be certain it is an integer before it gets there.
  const runner = runnerFor({});
  for (const months of [0, -3, 1.5, "12; DROP TABLE trip_tracking_points", NaN, null]) {
    // eslint-disable-next-line no-await-in-loop
    await assert.rejects(() => pruneLocationTrail({ runner, months }), /positive whole number/);
  }
  assert.equal(runner.statements.length, 0, "a bad period still reached the database");
});

test("the default matches the twelve months the policy states", () => {
  // If these drift apart the document becomes false again, which is the whole
  // reason this module exists.
  assert.equal(RETENTION_MONTHS, Number(process.env.LOCATION_TRAIL_MONTHS) || 12);
});

test("a failed prune is reported, not fatal", async () => {
  // Failing to delete old points is a problem to fix, not a reason to stop
  // serving trips.
  const lines = [];
  const timer = scheduleLocationRetention({
    prune: async () => { throw new Error("table is locked"); },
    log: { log: (m) => lines.push(String(m)), error: (m) => lines.push(String(m)) },
  });
  clearInterval(timer);

  await new Promise((r) => setImmediate(r));
  assert.ok(lines.some((l) => /Could not prune/.test(l)), lines.join("\n"));
});

test("the daily timer never holds the process open", async () => {
  /*
   * Learned the hard way today: a handle nothing releases turns a passing test
   * run into a hang, and a hang reports nothing at all. The same handle in a
   * server stops it shutting down.
   */
  const timer = scheduleLocationRetention({ prune: async () => ({ deleted: 0, months: 12 }) });
  assert.equal(typeof timer.hasRef, "function");
  assert.equal(timer.hasRef(), false, "the retention timer would keep the process alive");
  clearInterval(timer);
});
