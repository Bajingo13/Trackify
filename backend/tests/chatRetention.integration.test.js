import "../src/config/env.js";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import db from "../src/config/db.js";
import { pruneTripChat, scheduleChatRetention } from "../src/shared/chatRetention.js";

/**
 * Chat retention against the real schema: only messages on closed trips, older
 * than the period, in the companies named — and nothing on a running trip.
 * Fixtures are found, and everything written is removed.
 */

let closed;
let open;
let firstId;
const ids = {};

before(async () => {
  [[closed]] = await db.execute(
    "SELECT trip_ticket_id AS id, company_id AS companyId, branch_id AS branchId FROM trip_tickets WHERE status IN ('operationally_closed','cancelled') LIMIT 1"
  );
  [[open]] = await db.execute(
    "SELECT trip_ticket_id AS id, company_id AS companyId, branch_id AS branchId FROM trip_tickets WHERE status IN ('released','in_transit') LIMIT 1"
  );
  const [[{ maxId }]] = await db.execute("SELECT COALESCE(MAX(message_id), 0) AS maxId FROM trip_messages");
  firstId = Number(maxId) + 1;
  if (!closed || !open) return;

  const add = async (key, trip, monthsAgo) => {
    const [r] = await db.execute(
      `INSERT INTO trip_messages (company_id, branch_id, trip_ticket_id, sender_kind, sender_name, body, created_at)
       VALUES (?, ?, ?, 'staff', 'Retention test', ?, DATE_SUB(NOW(), INTERVAL ? MONTH))`,
      [trip.companyId, trip.branchId, trip.id, `retention ${key}`, monthsAgo]
    );
    ids[key] = r.insertId;
  };
  await add("oldClosed", closed, 13);
  await add("recentClosed", closed, 1);
  await add("oldOpen", open, 13);
  await db.execute(
    "INSERT INTO trip_message_reads (trip_ticket_id, reader_kind, reader_id, last_read_message_id) VALUES (?, 'staff', 999999, ?)",
    [closed.id, ids.recentClosed]
  );
});

after(async () => {
  await db.execute("DELETE FROM trip_messages WHERE message_id >= ?", [firstId]);
  await db.execute("DELETE FROM trip_message_reads WHERE reader_id = 999999");
  await db.end();
});

const exists = async (id) => ((await db.execute("SELECT 1 FROM trip_messages WHERE message_id = ?", [id]))[0]).length === 1;

test("a dry run reports without deleting", async (t) => {
  if (!closed || !open) return t.skip("fixtures missing");
  const result = await pruneTripChat({ months: 12, companyIds: [closed.companyId], dryRun: true });
  assert.ok(result.eligible >= 1);
  assert.equal(result.deleted, 0);
  assert.equal(await exists(ids.oldClosed), true);
});

test("another company's sweep leaves this company's chat alone", async (t) => {
  if (!closed || !open) return t.skip("fixtures missing");
  await pruneTripChat({ months: 12, companyIds: [closed.companyId + 100000] });
  assert.equal(await exists(ids.oldClosed), true);
});

test("only old messages on closed trips go; a running trip keeps its conversation", async (t) => {
  if (!closed || !open) return t.skip("fixtures missing");
  const result = await pruneTripChat({ months: 12, companyIds: [closed.companyId, open.companyId] });
  assert.ok(result.deleted >= 1);
  assert.equal(await exists(ids.oldClosed), false, "13-month-old message on a closed trip is deleted");
  assert.equal(await exists(ids.recentClosed), true, "a recent message on a closed trip is kept");
  assert.equal(await exists(ids.oldOpen), true, "a running trip is never trimmed");
  const [reads] = await db.execute("SELECT 1 FROM trip_message_reads WHERE reader_id = 999999");
  assert.equal(reads.length, 1, "a read marker for a conversation that still has messages is kept");
});

test("an empty company list sweeps nobody, and a bad period is refused", async () => {
  assert.deepEqual(await pruneTripChat({ months: 12, companyIds: [] }), { eligible: 0, deleted: 0, months: 12 });
  await assert.rejects(() => pruneTripChat({ months: 0 }), /positive whole number/);
});

test("the schedule never throws and never holds the process open", async () => {
  const logged = [];
  const timer = scheduleChatRetention({
    prune: async () => { throw new Error("database away"); },
    log: { log: () => {}, error: (m) => logged.push(m) },
  });
  await new Promise((r) => setTimeout(r, 20));
  clearInterval(timer);
  assert.match(logged[0], /Could not prune trip chat: database away/);
});
