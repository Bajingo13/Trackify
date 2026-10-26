import { test } from "node:test";
import assert from "node:assert/strict";
import { up } from "../../migrations/059_tracking_point_recovery.js";

/**
 * A stand-in connection that remembers which columns and indexes exist, the
 * way information_schema would, so the migration can be run twice.
 */
function fakeSchema() {
  const columns = new Set(["tracking_id", "driver_id", "gps_status", "recorded_at"]);
  const indexes = new Set(["PRIMARY"]);
  const alters = [];
  const conn = {
    async query(sql, params = []) {
      if (/information_schema\.COLUMNS/.test(sql)) return [columns.has(params[1]) ? [{ COLUMN_NAME: params[1] }] : []];
      if (/information_schema\.STATISTICS/.test(sql)) return [indexes.has(params[1]) ? [{ INDEX_NAME: params[1] }] : []];
      if (/^ALTER TABLE/.test(sql)) {
        alters.push(sql);
        const col = sql.match(/ADD COLUMN (\w+)/);
        if (col) columns.add(col[1]);
        const key = sql.match(/ADD UNIQUE KEY (\w+)/);
        if (key) indexes.add(key[1]);
        return [{}];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  return { conn, columns, indexes, alters };
}

test("059 adds the recovery columns and the duplicate guard, only adding", async () => {
  const s = fakeSchema();
  await up(s.conn);
  for (const col of ["client_ref", "received_at", "source"]) assert.ok(s.columns.has(col), col);
  assert.ok(s.indexes.has("uq_tp_driver_ref"));
  assert.ok(s.alters.every((sql) => /ADD (COLUMN|UNIQUE KEY)/.test(sql)), "only additions");
  assert.ok(s.alters.some((sql) => /ADD UNIQUE KEY uq_tp_driver_ref \(driver_id, client_ref\)/.test(sql)));
  // rows from before read as live, and an old row's NULL ref never collides
  assert.ok(s.alters.some((sql) => /source ENUM\('live','recovered'\) NOT NULL DEFAULT 'live'/.test(sql)));
  assert.ok(s.alters.some((sql) => /client_ref VARCHAR\(64\) NULL/.test(sql)));
});

test("059 run a second time changes nothing", async () => {
  const s = fakeSchema();
  await up(s.conn);
  const first = s.alters.length;
  await up(s.conn);
  assert.equal(s.alters.length, first);
});
