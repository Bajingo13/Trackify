import "../config/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { AUTO_CLOSE_DAYS, closeStaleResolved, scheduleSupportAutoClose } from "./supportAutoClose.js";

const norm = (sql) => String(sql).replace(/\s+/g, " ").trim();

test("only a resolved request that has been quiet for the whole period is closed", async () => {
  const calls = [];
  const runner = { execute: async (sql, params) => { calls.push({ sql: norm(sql), params }); return [{ affectedRows: 3 }]; } };
  const result = await closeStaleResolved({ runner });

  assert.deepEqual(result, { closed: 3, days: AUTO_CLOSE_DAYS });
  assert.equal(calls.length, 1);
  const { sql } = calls[0];
  assert.match(sql, /SET status = 'closed'/);
  assert.match(sql, /WHERE status = 'resolved'/, "an open or being-handled request is never touched");
  assert.match(sql, /resolved_at < DATE_SUB\(NOW\(\), INTERVAL 7 DAY\)/);
  assert.match(sql, /updated_at < DATE_SUB\(NOW\(\), INTERVAL 7 DAY\)/, "a conversation still going is left alone");
});

test("the period is a positive whole number of days, so nothing odd reaches the SQL", async () => {
  const runner = { execute: async () => { throw new Error("nothing should be queried"); } };
  for (const days of [0, -1, 1.5, "7; DROP TABLE x", NaN]) {
    await assert.rejects(() => closeStaleResolved({ days, runner }), /positive whole number/);
  }
});

test("the sweep says what it closed, and a failure is logged, never thrown", async () => {
  const lines = [];
  const log = { log: (m) => lines.push(["log", m]), error: (m) => lines.push(["error", m]) };
  const timer = scheduleSupportAutoClose({ log, close: async () => ({ closed: 2 }), intervalMs: 60_000 });
  clearInterval(timer);
  await new Promise((r) => setImmediate(r));
  assert.match(lines[0][1], /Closed 2 resolved request/);

  const lines2 = [];
  const timer2 = scheduleSupportAutoClose({
    log: { log: (m) => lines2.push(m), error: (m) => lines2.push(m) },
    close: async () => { throw new Error("db down"); },
    intervalMs: 60_000,
  });
  clearInterval(timer2);
  await new Promise((r) => setImmediate(r));
  assert.match(lines2[0], /Could not close old resolved requests: db down/);
});
