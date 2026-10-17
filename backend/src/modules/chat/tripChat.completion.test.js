import "../../config/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import db from "../../config/db.js";
import { deleteConversation, tripCompletion } from "./tripChat.service.js";

function withDb(result, fn) {
  const calls = [];
  const real = db.execute;
  db.execute = async (sql, params) => {
    calls.push({ sql: String(sql).replace(/\s+/g, " ").trim(), params });
    return result;
  };
  return fn(calls).finally(() => { db.execute = real; });
}

test("a completed trip exposes the submitted form without a full address", async () => {
  const row = {
    status: "operationally_closed",
    receivedBy: "Maria Santos",
    note: "Two crates short",
    lat: "6.7501000",
    lng: "125.3560000",
    capturedAt: "2026-10-17T08:30:00.000Z",
    statusAt: "2026-10-17T09:00:00.000Z",
    driverName: "Jose Garcia",
    hasPhoto: 1,
  };
  await withDb([[row]], async (calls) => {
    const completion = await tripCompletion(15, 2);
    assert.deepEqual(completion, {
      state: "closed",
      receivedBy: "Maria Santos",
      lat: 6.7501,
      lng: 125.356,
      note: "Two crates short",
      confirmedAt: row.capturedAt,
      completedAt: row.statusAt,
      driverName: "Jose Garcia",
      hasPhoto: true,
    });
    assert.deepEqual(calls[0].params, [15, 2]);
    assert.doesNotMatch(calls[0].sql, /origin|destination|address/i);
  });
});

test("deleting a chat hides an older completion event for that reader", async () => {
  const row = {
    status: "delivered",
    receivedBy: "Maria Santos",
    actualArrival: "2026-10-17T08:30:00.000Z",
    statusAt: "2026-10-17T08:30:00.000Z",
  };
  await withDb([[row]], async () => {
    const completion = await tripCompletion(15, 2, { deletedAt: "2026-10-17T09:00:00.000Z" });
    assert.equal(completion, null);
  });
});

test("Delete Chat records a per-reader cutoff rather than erasing messages", async () => {
  await withDb([{}], async (calls) => {
    await deleteConversation({ tripId: 15, readerKind: "staff", readerId: 9 });
    assert.match(calls[0].sql, /^INSERT INTO trip_chat_deletions/);
    assert.doesNotMatch(calls[0].sql, /DELETE FROM trip_messages/);
    assert.deepEqual(calls[0].params, [15, "staff", 9]);
  });
});
