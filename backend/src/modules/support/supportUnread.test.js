import "../../config/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import db from "../../config/db.js";
import { driverUnread } from "./support.controller.js";

/**
 * What the Driver App's bell is told about Help & Support: how many requests
 * the office has answered, and which, so each can be its own notification.
 */
test("the unread summary carries the answered requests, scoped to the driver", async () => {
  const calls = [];
  const real = db.execute;
  db.execute = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes("COUNT(*) AS n")) return [[{ n: 1 }]];
    return [[{
      id: 31, subject: "Pause request: Emergency", tripId: 32, tripNo: "TT-2026-000032",
      unread: 2, lastAt: "2026-10-15 10:00:00", lastBody: "Stay where\n you are,   help is coming.",
    }]];
  };
  const out = {};
  try {
    await driverUnread({ driver: { driverId: 7, companyId: 1 } }, { json(v) { out.body = v; } });
  } finally {
    db.execute = real;
  }

  assert.equal(out.body.data.unread, 1, "the Help button's count is unchanged");
  assert.deepEqual(out.body.data.tickets, [{
    id: 31, ticketNo: "SUP-000031", subject: "Pause request: Emergency", tripId: 32, tripNo: "TT-2026-000032",
    unread: 2, lastAt: "2026-10-15 10:00:00", preview: "Stay where you are, help is coming.",
  }]);
  const list = calls.find((c) => c.sql.includes("GROUP BY t.ticket_id"));
  assert.deepEqual(list.params, [7, 1], "only this driver's requests, in their company");
  assert.match(list.sql, /sender_kind = 'staff' AND m\.message_id > t\.driver_last_read_message_id/, "only office replies not yet read");
});

test("the console's bell lists drivers' unread requests, with the exception to open", async () => {
  const { unreadListForStaff } = await import("./support.service.js");
  const calls = [];
  const real = db.execute;
  db.execute = async (sql, params) => {
    calls.push({ sql, params });
    return [[{ id: 40, subject: "Flat tyre", driverName: "Juan Dela Cruz", tripNo: "TT-2026-000032", exceptionId: 88, unread: 3, lastAt: "2026-10-15 09:00:00", lastBody: "Need   a jack" }]];
  };
  try {
    const rows = await unreadListForStaff({ companyId: 1, branchId: 2 });
    assert.deepEqual(rows, [{ id: 40, ticketNo: "SUP-000040", subject: "Flat tyre", driverName: "Juan Dela Cruz", tripNo: "TT-2026-000032", exceptionId: 88, unread: 3, lastAt: "2026-10-15 09:00:00", preview: "Need a jack" }]);
  } finally {
    db.execute = real;
  }
  assert.deepEqual(calls[0].params, [1, 2], "the operating branch only");
  assert.match(calls[0].sql, /sender_kind = 'driver' AND m\.message_id > t\.staff_last_read_message_id/, "drivers' messages the office has not read");
  assert.match(calls[0].sql, /source_kind = 'pause'/, "a pause's request opens the pause's exception");
});
