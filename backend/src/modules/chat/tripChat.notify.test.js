import "../../config/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import db from "../../config/db.js";
import { postMessage } from "./tripChat.service.js";

/**
 * Dispatch writing in a run's chat tells the driver the run is assigned to;
 * a driver writing does not notify themselves. (The live delivery itself is
 * covered end to end by tests/chat-notifications.e2e.mjs.)
 */
function withDb(fn) {
  const calls = [];
  const real = db.execute;
  db.execute = async (sql, params) => {
    const text = String(sql).replace(/\s+/g, " ").trim();
    calls.push({ sql: text, params });
    if (text.startsWith("INSERT INTO trip_messages")) return [{ insertId: 501 }];
    if (text.includes("FROM trip_messages WHERE message_id = ?")) {
      return [[{ id: 501, tripId: 12, senderKind: "staff", senderName: "Ana (Dispatch)", body: "Gate 3,   not gate 1", createdAt: "2026-10-15 09:00:00", hasPhoto: 0 }]];
    }
    if (text.includes("FROM trip_assignments ta")) return [[{ driverId: 7, ticketNo: "TT-2026-000012" }]];
    return [{}];
  };
  return fn(calls).finally(() => { db.execute = real; });
}

test("a message from dispatch looks up the run's current driver to tell them", async () => {
  await withDb(async (calls) => {
    await postMessage({ companyId: 1, branchId: 2, tripId: 12, senderKind: "staff", senderUserId: 9, senderName: "Ana", body: "Gate 3" });
    const lookup = calls.find((c) => c.sql.includes("FROM trip_assignments ta"));
    assert.ok(lookup, "the driver is looked up");
    assert.deepEqual(lookup.params, [12, 1], "by trip, within the company");
    assert.match(lookup.sql, /ta\.is_current = TRUE/, "only the driver on it now");
  });
});

test("a driver's own message does not notify the driver", async () => {
  await withDb(async (calls) => {
    await postMessage({ companyId: 1, branchId: 2, tripId: 12, senderKind: "driver", senderDriverId: 7, senderName: "Juan", body: "At the gate" });
    assert.equal(calls.some((c) => c.sql.includes("FROM trip_assignments ta")), false);
  });
});

test("a failed notice never fails the message", async () => {
  const real = db.execute;
  db.execute = async (sql) => {
    const text = String(sql);
    if (text.includes("FROM trip_assignments ta")) throw new Error("connection lost");
    if (text.includes("INSERT INTO trip_messages")) return [{ insertId: 502 }];
    if (text.includes("WHERE message_id = ?")) return [[{ id: 502, tripId: 12, senderKind: "staff", senderName: "Ana", body: "x", hasPhoto: 0 }]];
    return [{}];
  };
  try {
    const { message } = await postMessage({ companyId: 1, branchId: 2, tripId: 12, senderKind: "staff", senderUserId: 9, senderName: "Ana", body: "x" });
    assert.equal(message.id, 502);
  } finally {
    db.execute = real;
  }
});
