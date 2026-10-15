import "../../config/env.js";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import db from "../../config/db.js";
import { UPLOAD_ROOT } from "../finance/receipts.storage.js";
import * as bridge from "./exceptionBridge.service.js";
import { openForPause, openForTicket, settleForPause, settleForTicket } from "./exceptionSync.service.js";
import {
  activeByTrip, approve, createForDriver, decline, endForTrip, linkForTrip, publicView, resumeAsDriver,
  resumeAsStaff, revokeLinks, withdrawAsDriver,
} from "./pause.service.js";

/**
 * Pause requests.
 *
 * What these guard: who may pause what (only their own in-transit trip, one at
 * a time), that a request carries evidence, that the exception, the pause and
 * the ticket move together, and — the part that is easy to get wrong — how
 * little a customer is shown. The wording and the screens are covered elsewhere.
 */

const norm = (sql) => String(sql).replace(/\s+/g, " ").trim();

async function withDb(handler, fn) {
  const real = { execute: db.execute, getConnection: db.getConnection };
  const calls = [];
  const run = async (sql, params) => {
    calls.push({ sql: norm(sql), params });
    return handler(norm(sql), params);
  };
  db.execute = run;
  db.getConnection = async () => ({
    beginTransaction: async () => { calls.push({ sql: "BEGIN" }); },
    commit: async () => { calls.push({ sql: "COMMIT" }); },
    rollback: async () => { calls.push({ sql: "ROLLBACK" }); },
    release: () => {},
    execute: run,
  });
  try {
    return await fn(calls);
  } finally {
    db.execute = real.execute;
    db.getConnection = real.getConnection;
  }
}

const driver = { driverId: 9, companyId: 7, branchId: 3, name: "Juan Dela Cruz", employeeNo: "DRV-009" };
const context = { companyId: 7, branchId: 3 };
const staff = { userId: 2, email: "ana@example.com", name: "Ana Reyes" };
const photo = (name = "a.jpg") => ({ path: path.join(UPLOAD_ROOT, "pauses", "2026", "10", name), mimetype: "image/jpeg", size: 1234 });

const pauseRow = (extra = {}) => ({
  id: 7, ticketId: 41, tripId: 31, tripNo: "TT-2026-000031", companyId: 7, branchId: 3, driverId: 9,
  driverName: "Juan Dela Cruz", reason: "breakdown", description: "The engine overheated and stopped.",
  latitude: null, longitude: null, status: "pending", requestedAt: "2026-10-14T08:00:00", reviewedAt: null,
  reviewedByName: null, reviewNote: null, customerMessage: null, resumedAt: null, resumedBy: null, ...extra,
});
const valid = { reason: "breakdown", description: "The engine overheated and stopped on the highway." };

/* ---- asking for a pause ---- */

test("a request needs a reason, a real description, and — except in an emergency — a photograph", async () => {
  await withDb(() => { throw new Error("nothing should be queried"); }, async (calls) => {
    const noReason = await createForDriver({ driver, tripId: 31, input: { description: valid.description }, files: [photo()] });
    assert.equal(noReason.status, 400);
    assert.match(noReason.error, /what happened/);

    const brief = await createForDriver({ driver, tripId: 31, input: { reason: "delay", description: "too short" }, files: [photo()] });
    assert.equal(brief.status, 400);
    assert.match(brief.error, /Describe what happened/);

    const noPhoto = await createForDriver({ driver, tripId: 31, input: valid, files: [] });
    assert.equal(noPhoto.status, 400);
    assert.match(noPhoto.error, /at least one photo/);
    assert.equal(calls.length, 0, "refused before anything was looked up");
  });
});

test("an emergency is not made to stop and take photographs first", async () => {
  await withDb(
    (sql) => {
      if (sql.includes("AND client_ref = ?")) return [[]];
      if (sql.includes("FROM trip_assignments")) return [[]]; // stops at the trip check: evidence was not the objection
      throw new Error(`unexpected: ${sql}`);
    },
    async () => {
      const result = await createForDriver({
        driver, tripId: 31, input: { reason: "emergency", description: "Someone has been hurt at the gate.", clientRef: "abcd1234efgh" }, files: [],
      });
      assert.equal(result.status, 404, "reached the trip check, so the missing photo was allowed");
    }
  );
});

test("a pause can only be asked for on the driver's own trip, and only once it is on the road", async () => {
  await withDb(
    (sql) => (sql.includes("FROM trip_assignments") ? [[]] : [[]]),
    async (calls) => {
      const result = await createForDriver({ driver, tripId: 555, input: valid, files: [photo()] });
      assert.equal(result.status, 404);
      assert.deepEqual(calls.find((c) => c.sql.includes("FROM trip_assignments")).params, [9, 7, 555]);
    }
  );
  await withDb(
    (sql) => (sql.includes("FROM trip_assignments") ? [[{ id: 31, branchId: 3, status: "released", tripNo: "TT-1" }]] : [[]]),
    async () => {
      const result = await createForDriver({ driver, tripId: 31, input: valid, files: [photo()] });
      assert.equal(result.status, 409);
      assert.match(result.error, /on the road/);
    }
  );
});

test("one pause at a time on a delivery, and the message says which kind is in the way", async () => {
  const trip = [[{ id: 31, branchId: 3, status: "in_transit", tripNo: "TT-1" }]];
  for (const [status, expected] of [["pending", /already have a pause request waiting/], ["approved", /already paused/]]) {
    await withDb(
      (sql) => {
        if (sql.includes("FROM trip_assignments")) return trip;
        if (sql.includes("FROM trip_pauses WHERE trip_ticket_id")) return [[{ id: 7, status }]];
        return [[]];
      },
      async () => {
        const result = await createForDriver({ driver, tripId: 31, input: valid, files: [photo()] });
        assert.equal(result.status, 409);
        assert.match(result.error, expected);
      }
    );
  }
});

test("a pause is filed with its ticket, its exception and its evidence in one transaction", async () => {
  await withDb(
    (sql) => {
      if (sql.includes("AND client_ref = ?")) return [[]];
      if (sql.includes("FROM trip_assignments")) return [[{ id: 31, branchId: 3, status: "in_transit", tripNo: "TT-2026-000031" }]];
      if (sql.includes("FROM trip_pauses WHERE trip_ticket_id")) return [[]];
      if (sql.startsWith("INSERT INTO support_tickets")) return [{ insertId: 41 }];
      if (sql.startsWith("INSERT INTO support_messages")) return [{ insertId: 1 }];
      if (sql.startsWith("INSERT INTO trip_pauses")) return [{ insertId: 7 }];
      if (sql.includes("FROM trip_pause_photos")) return [[{ id: 1, mime: "image/jpeg", size: 1234, createdAt: "x" }]];
      if (sql.includes("FROM trip_pauses p JOIN trip_tickets") || sql.includes("FROM trip_pauses p JOIN")) return [[pauseRow()]];
      return [{}];
    },
    async (calls) => {
      const result = await createForDriver({
        driver, tripId: 31, input: { ...valid, lat: "7.0731", lng: "125.6128", clientRef: "abcd1234efgh" }, files: [photo("a.jpg"), photo("b.jpg")],
      });
      assert.equal(result.duplicate, false);
      assert.equal(result.pause.reasonLabel, "Vehicle breakdown");
      assert.equal(result.pause.status, "pending");

      const sqls = calls.map((c) => c.sql);
      const at = (prefix) => sqls.findIndex((s) => s.startsWith(prefix));
      const begin = at("BEGIN");
      const ticket = at("INSERT INTO support_tickets");
      const pause = at("INSERT INTO trip_pauses");
      const exception = at("INSERT INTO operational_exceptions");
      const history = at("INSERT INTO trip_status_history");
      const commit = at("COMMIT");
      assert.ok(begin >= 0 && begin < ticket && ticket < pause && pause < exception && exception < history && history < commit,
        "ticket, pause, exception and history all land inside one transaction");
      assert.equal(sqls.filter((s) => s.startsWith("INSERT INTO trip_pause_photos")).length, 2);

      // the ticket is urgent for a breakdown, filed under the trip's own branch, and the pause records where it was
      assert.equal(calls[ticket].params[1], 3);
      assert.equal(calls[ticket].params[6], "urgent");
      assert.equal(calls[pause].params[8], 7.0731);
      assert.equal(calls[pause].params[9], 125.6128);
      // the exception is the breakdown kind and points back at the pause
      assert.match(calls[exception].sql, /'pause'/);
      assert.equal(calls[exception].params[3], 7);
      assert.equal(calls[exception].params[4], "vehicle_breakdown");
      // the trip's history says what happened, without changing the trip's status
      assert.match(calls[history].sql, /'in_transit', 'in_transit'/);
      assert.equal(calls[history].params[3], "PAUSE_REQUESTED");
      assert.ok(!sqls.some((s) => /^UPDATE trip_tickets/.test(s)), "the trip itself is untouched");
    }
  );
});

test("the time recorded is when the driver pressed Send, but a phone's clock is only believed within reason", async () => {
  const handler = (sql) => {
    if (sql.includes("AND client_ref = ?")) return [[]];
    if (sql.includes("FROM trip_assignments")) return [[{ id: 31, branchId: 3, status: "in_transit", tripNo: "TT-1" }]];
    if (sql.includes("FROM trip_pauses WHERE trip_ticket_id")) return [[]];
    if (sql.startsWith("INSERT INTO support_tickets")) return [{ insertId: 41 }];
    if (sql.startsWith("INSERT INTO support_messages")) return [{ insertId: 1 }];
    if (sql.startsWith("INSERT INTO trip_pauses")) return [{ insertId: 7 }];
    if (sql.includes("FROM trip_pause_photos")) return [[]];
    if (sql.includes("FROM trip_pauses p JOIN")) return [[pauseRow()]];
    return [{}];
  };
  const sentAt = async (requestedAt) => {
    let recorded;
    await withDb(handler, async (calls) => {
      await createForDriver({ driver, tripId: 31, input: { ...valid, clientRef: "abcd1234efgh", requestedAt }, files: [photo()] });
      recorded = calls.find((c) => c.sql.startsWith("INSERT INTO trip_pauses")).params[11];
    });
    return recorded;
  };

  // parked on a phone for forty minutes: the pause began when it was pressed
  const earlier = new Date(Date.now() - 40 * 60 * 1000);
  assert.equal((await sentAt(earlier.toISOString())).getTime(), earlier.getTime());
  // nonsense, the future, or days ago: the server's own clock decides
  assert.equal(await sentAt("not a date"), null);
  assert.equal(await sentAt(new Date(Date.now() + 3600 * 1000).toISOString()), null);
  assert.equal(await sentAt(new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString()), null);
  assert.equal(await sentAt(undefined), null);
});

test("a replay of the same request returns the one already filed and files nothing", async () => {
  await withDb(
    (sql) => {
      if (sql.includes("AND client_ref = ?")) return [[{ id: 7 }]];
      if (sql.includes("FROM trip_pause_photos")) return [[]];
      if (sql.includes("FROM trip_pauses p JOIN")) return [[pauseRow()]];
      throw new Error(`unexpected: ${sql}`);
    },
    async (calls) => {
      const result = await createForDriver({ driver, tripId: 31, input: { ...valid, clientRef: "abcd1234efgh" }, files: [photo()] });
      assert.equal(result.duplicate, true);
      assert.equal(result.pause.id, 7);
      assert.ok(!calls.some((c) => c.sql.startsWith("INSERT")), "nothing inserted");
    }
  );
});

/* ---- the office's answer ---- */

const decisionDb = (status, extra = {}) => (sql) => {
  if (sql.includes("FROM trip_pauses WHERE ticket_id = ?") && sql.includes("FOR UPDATE")) {
    return [[{ id: 7, ticketId: 41, tripId: 31, status, reason: "breakdown", ...extra }]];
  }
  if (sql.startsWith("INSERT INTO support_messages")) return [{ insertId: 9 }];
  if (sql.includes("FROM trip_pause_photos")) return [[]];
  if (sql.includes("FROM trip_pauses p JOIN")) return [[pauseRow({ status: status === "pending" ? "approved" : status })]];
  return [{}];
};

test("approving a pause updates the pause, the exception, the ticket and the driver — together", async () => {
  await withDb(decisionDb("pending"), async (calls) => {
    const result = await approve({ context, user: staff, ticketId: 41, input: { note: "Take your time.", customerMessage: "Your truck is being repaired." } });
    assert.ok(result.pause, "answered");

    const sqls = calls.map((c) => c.sql);
    const upd = calls.find((c) => c.sql.startsWith("UPDATE trip_pauses") && c.sql.includes("'approved'"));
    assert.ok(upd, "the pause is approved");
    assert.deepEqual(upd.params.slice(0, 4), [2, "Ana Reyes", "Take your time.", "Your truck is being repaired."]);

    assert.ok(sqls.some((s) => s.includes("UPDATE operational_exceptions SET status = 'acknowledged'")), "the exception is acknowledged");
    const note = calls.find((c) => c.sql.startsWith("INSERT INTO support_messages"));
    assert.match(note.params[3], /approved/, "the driver is told in the thread");
    assert.ok(sqls.some((s) => s.startsWith("UPDATE support_tickets SET status = ?")), "the ticket moves on");
    assert.equal(calls.find((c) => c.sql.startsWith("INSERT INTO trip_status_history")).params[3], "PAUSE_APPROVED");
    assert.ok(sqls.indexOf("COMMIT") > sqls.findIndex((s) => s.startsWith("UPDATE operational_exceptions")));
  });
});

test("declining needs a reason the driver can act on, and resolves the exception", async () => {
  await withDb(decisionDb("pending"), async () => {
    const blank = await decline({ context, user: staff, ticketId: 41, input: { note: " " } });
    assert.equal(blank.status, 400);
    assert.match(blank.error, /Tell the driver why/);
  });
  await withDb(decisionDb("pending"), async (calls) => {
    const result = await decline({ context, user: staff, ticketId: 41, input: { note: "The road is open; please continue." } });
    assert.ok(result.pause);
    const resolved = calls.find((c) => c.sql.includes("UPDATE operational_exceptions SET status = 'resolved'"));
    assert.ok(resolved, "a declined pause resolves its exception");
    assert.match(resolved.params[1], /declined by Ana Reyes: The road is open/);
  });
});

test("an answered request cannot be answered again, and only an approved pause can be resumed", async () => {
  await withDb(decisionDb("approved"), async () => {
    const again = await approve({ context, user: staff, ticketId: 41, input: {} });
    assert.equal(again.status, 409);
    assert.match(again.error, /already been answered/);
  });
  await withDb(decisionDb("pending"), async () => {
    const early = await resumeAsStaff({ context, user: staff, ticketId: 41, input: {} });
    assert.equal(early.status, 409);
    assert.match(early.error, /isn't paused/);
  });
});

test("a pause from another branch is simply not found", async () => {
  await withDb(() => [[]], async (calls) => {
    const result = await approve({ context, user: staff, ticketId: 41, input: {} });
    assert.equal(result.status, 404);
    assert.deepEqual(calls.find((c) => c.sql.includes("FOR UPDATE")).params, [41, 7, 3]);
  });
});

test("resuming resolves the exception and leaves the delivery running again", async () => {
  await withDb(decisionDb("approved"), async (calls) => {
    const result = await resumeAsStaff({ context, user: staff, ticketId: 41, input: { note: "Truck repaired." } });
    assert.ok(result.pause);
    assert.ok(calls.some((c) => c.sql.includes("status = 'resumed', resumed_at = NOW(3), resumed_by = 'staff'")));
    const resolved = calls.find((c) => c.sql.includes("UPDATE operational_exceptions SET status = 'resolved'"));
    assert.match(resolved.params[1], /Delivery resumed — the pause was ended by Ana Reyes: Truck repaired/);
    assert.equal(calls.find((c) => c.sql.startsWith("INSERT INTO trip_status_history")).params[3], "PAUSE_RESUMED");
  });
});

/* ---- the driver ending their own ---- */

const driverEndDb = (status) => (sql) => {
  if (sql.includes("FROM trip_pauses") && sql.includes("FOR UPDATE")) return [[{ id: 7, ticketId: 41, branchId: 3, status }]];
  if (sql.includes("FROM trip_pause_photos")) return [[]];
  if (sql.includes("FROM trip_pauses p JOIN")) return [[pauseRow({ status: "resumed" })]];
  return [{}];
};

test("a driver may withdraw a request nobody has answered, and may not once it has been", async () => {
  await withDb(driverEndDb("pending"), async (calls) => {
    const ok = await withdrawAsDriver({ driver, tripId: 31 });
    assert.ok(ok.pause);
    assert.ok(calls.some((c) => c.sql.includes("UPDATE operational_exceptions SET status = 'resolved'")), "its exception is resolved");
  });
  await withDb(driverEndDb("approved"), async (calls) => {
    const refused = await withdrawAsDriver({ driver, tripId: 31 });
    assert.equal(refused.status, 409);
    assert.match(refused.error, /already answered/);
    assert.ok(calls.some((c) => c.sql === "ROLLBACK"));
  });
});

test("a driver may resume only a pause the office has approved", async () => {
  await withDb(driverEndDb("pending"), async () => {
    const early = await resumeAsDriver({ driver, tripId: 31 });
    assert.equal(early.status, 409);
    assert.match(early.error, /hasn't approved/);
  });
  await withDb(driverEndDb("approved"), async (calls) => {
    const ok = await resumeAsDriver({ driver, tripId: 31 });
    assert.ok(ok.pause);
    assert.ok(calls.some((c) => c.sql.includes("resumed_by = 'driver'")));
    assert.ok(calls.some((c) => c.sql.includes("UPDATE operational_exceptions SET status = 'resolved'")));
  });
});

test("a delivery that finishes ends any pause on it, whichever state it was in", async () => {
  await withDb(
    (sql) => {
      if (sql.includes("FROM trip_pauses p JOIN")) {
        return [[pauseRow({ id: 7, status: "approved" }), pauseRow({ id: 8, ticketId: 42, status: "pending" })]];
      }
      return [{}];
    },
    async (calls) => {
      await endForTrip(31);
      const ended = calls.filter((c) => c.sql.startsWith("UPDATE trip_pauses SET status = ?"));
      assert.deepEqual(ended.map((c) => c.params.slice(0, 2)), [["resumed", 7], ["cancelled", 8]]);
      assert.ok(ended.every((c) => c.sql.includes("resumed_by = 'delivery'")));
    }
  );
});

/* ---- the live board ---- */

test("the board is told which trips are paused, and only for the branch being operated in", async () => {
  await withDb(
    () => [[pauseRow({ id: 7, tripId: 31, status: "approved" })]],
    async (calls) => {
      const map = await activeByTrip({ companyId: 7, branchId: 3, tripIds: [31, 32, "x", -1] });
      assert.equal(map.get(31).status, "approved");
      assert.equal(map.get(31).reasonLabel, "Vehicle breakdown");
      assert.equal(map.size, 1);
      assert.deepEqual(calls[0].params, [7, 3, 31, 32]);
    }
  );
  await withDb(() => { throw new Error("no query for no trips"); }, async () => {
    assert.equal((await activeByTrip({ companyId: 7, branchId: 3, tripIds: [] })).size, 0);
  });
});

/* ---- the customer's link ---- */

test("a tracking link is made for a trip in this branch, reused while it works, and never for another branch's", async () => {
  await withDb(() => [[]], async () => {
    const other = await linkForTrip({ context, user: { userId: 2 }, tripId: 31 });
    assert.equal(other.status, 404);
  });
  await withDb(
    (sql) => {
      if (sql.startsWith("SELECT trip_ticket_id AS id FROM trip_tickets")) return [[{ id: 31 }]];
      if (sql.includes("FROM trip_tracking_links") && sql.includes("revoked_at IS NULL")) return [[{ token: "existing-token-0123456789abcdef", expiresAt: "2026-11-01" }]];
      throw new Error(`unexpected: ${sql}`);
    },
    async (calls) => {
      const result = await linkForTrip({ context, user: { userId: 2 }, tripId: 31 });
      assert.equal(result.link.token, "existing-token-0123456789abcdef");
      assert.ok(!result.created);
      assert.ok(!calls.some((c) => c.sql.startsWith("INSERT")), "no second link while one works");
    }
  );
  await withDb(
    (sql) => {
      if (sql.startsWith("SELECT trip_ticket_id AS id FROM trip_tickets")) return [[{ id: 31 }]];
      if (sql.includes("revoked_at IS NULL")) return [[]];
      if (sql.includes("WHERE token = ?")) return [[{ token: "x", expiresAt: "2026-11-13", createdAt: "now", viewCount: 0 }]];
      return [{}];
    },
    async (calls) => {
      const result = await linkForTrip({ context, user: { userId: 2 }, tripId: 31 });
      assert.ok(result.created);
      const insert = calls.find((c) => c.sql.startsWith("INSERT INTO trip_tracking_links"));
      const token = insert.params[3];
      assert.match(token, /^[A-Za-z0-9_-]{43}$/, "32 random bytes, URL-safe");
    }
  );
});

test("revoking a link is scoped to the branch and says how many it stopped", async () => {
  await withDb(() => [{ affectedRows: 1 }], async (calls) => {
    const out = await revokeLinks({ context, tripId: 31 });
    assert.equal(out.revoked, 1);
    assert.deepEqual(calls[0].params, [31, 7, 3]);
  });
});

const linkRow = (extra = {}) => ({
  linkId: 5, tripId: 31, expiresAt: new Date(Date.now() + 86_400_000).toISOString(), revokedAt: null,
  tripNo: "TT-2026-000031", status: "in_transit", origin: "Davao City", destination: "Zamboanga City",
  scheduledArrival: "2026-10-15T13:00:00", departedAt: "2026-10-14T06:00:00", arrivedAt: null,
  companyName: "AstreaBlue Logistics", customerName: "Miami Trading", ...extra,
});

test("a link that is unknown, revoked or expired all answer the same, so a guessed token learns nothing", async () => {
  const token = "A".repeat(43);
  assert.deepEqual(await publicView("short"), { gone: true });
  assert.deepEqual(await publicView(undefined), { gone: true });
  for (const row of [undefined, linkRow({ revokedAt: "2026-10-13" }), linkRow({ expiresAt: new Date(Date.now() - 1000).toISOString() })]) {
    await withDb(() => [row ? [row] : []], async () => {
      assert.deepEqual(await publicView(token), { gone: true });
    });
  }
});

test("a customer is told the delivery is paused and why — and nothing the driver or the office wrote for themselves", async () => {
  const token = "B".repeat(43);
  await withDb(
    (sql) => {
      if (sql.includes("FROM trip_tracking_links")) return [[linkRow()]];
      if (sql.includes("FROM trip_pauses")) {
        return [[{ reason: "breakdown", status: "approved", startedAt: "2026-10-14T09:00:00", endedAt: null, message: null }]];
      }
      return [{}];
    },
    async () => {
      const { view } = await publicView(token);
      assert.equal(view.stage, "paused");
      assert.equal(view.statusLabel, "Paused");
      assert.equal(view.pause.reasonLabel, "Vehicle breakdown");
      assert.match(view.pause.message, /mechanical problem/, "the standard sentence when the office wrote none");
      assert.equal(view.pause.active, true);

      // no driver, no description, no photographs, no position, no internal notes
      const text = JSON.stringify(view);
      for (const leaked of ["Juan", "engine", "description", "photo", "latitude", "longitude", "driverName", "reviewNote", "reviewedBy"]) {
        assert.ok(!text.includes(leaked), `the customer's page must not carry "${leaked}"`);
      }
    }
  );
});

test("a customer sees the office's own words when it wrote some, and a resumed pause as history", async () => {
  const token = "C".repeat(43);
  await withDb(
    (sql) => {
      if (sql.includes("FROM trip_tracking_links")) return [[linkRow()]];
      if (sql.includes("FROM trip_pauses")) {
        return [[{ reason: "delay", status: "resumed", startedAt: "2026-10-14T08:00:00", endedAt: "2026-10-14T09:30:00", message: "Heavy flooding on the highway." }]];
      }
      return [{}];
    },
    async () => {
      const { view } = await publicView(token);
      assert.equal(view.stage, "on_the_way", "no pause now: on the way again");
      assert.equal(view.pause, null);
      assert.equal(view.pastPauses.length, 1);
      assert.equal(view.pastPauses[0].message, "Heavy flooding on the highway.");
      assert.ok(view.pastPauses[0].endedAt);
    }
  );
});

/* ---- exception sync ---- */

test("a pause is raised as an exception of the right kind and severity, once", async () => {
  await withDb(() => [{}], async (calls) => {
    await openForPause(db, {
      companyId: 7, branchId: 3, tripId: 31, pauseId: 7, reason: "emergency", reasonLabel: "Emergency",
      driverName: "Juan Dela Cruz", description: "Someone was hurt.", latitude: 7.1, longitude: 125.6,
    });
    const call = calls[0];
    assert.match(call.sql, /ON DUPLICATE KEY UPDATE/, "a second call does not make a second exception");
    assert.deepEqual(call.params.slice(0, 6), [7, 3, 31, 7, "driver_emergency", "critical"]);
    assert.equal(call.params[6], "Pause request: Emergency");
    assert.match(call.params[7], /^Juan Dela Cruz: Someone was hurt/);
  });
});

test("a concern a driver filed is an exception, critical when it is about safety or marked urgent", async () => {
  await withDb(() => [{}], async (calls) => {
    await openForTicket(db, { companyId: 7, branchId: 3, tripId: 31, ticketId: 41, category: "safety", priority: "normal", driverName: "Juan", subject: "Gate has no lights", body: "Dark." });
    await openForTicket(db, { companyId: 7, branchId: 3, ticketId: 42, category: "vehicle", priority: "urgent", driverName: "Juan", subject: "Brakes", body: "Soft." });
    await openForTicket(db, { companyId: 7, branchId: 3, ticketId: 43, category: "trip", priority: "normal", driverName: "Juan", subject: "Wrong address", body: "Check." });
    // params: company, branch, trip, ticket, severity, title, description
    assert.deepEqual(calls.map((c) => c.params[4]), ["critical", "critical", "warning"]);
    assert.deepEqual(calls.map((c) => c.params[3]), [41, 42, 43]);
    assert.equal(calls[0].params[5], "Driver report: Gate has no lights");
  });
});

test("the exception follows the pause: approved is acknowledged, anything that ends it is resolved", async () => {
  await withDb(() => [{}], async (calls) => {
    await settleForPause(db, 7, { status: "approved", userId: 2 });
    await settleForPause(db, 7, { status: "resumed", userId: 2, note: "Done." });
    await settleForPause(db, 7, { status: "declined", userId: 2, note: "No." });
    await settleForPause(db, 7, { status: "cancelled", note: "Withdrawn." });
    await settleForPause(db, 7, { status: "pending" }); // nothing to follow
    assert.equal(calls.length, 4);
    assert.match(calls[0].sql, /status = 'acknowledged'/);
    for (const c of calls.slice(1)) assert.match(c.sql, /status = 'resolved'/);
    assert.ok(calls.every((c) => /source_kind = 'pause'/.test(c.sql)), "only exceptions that came from a pause are touched");
  });
});

test("the exception follows a request's status, and reopens when the driver writes back", async () => {
  await withDb(() => [{}], async (calls) => {
    await settleForTicket(db, 41, "in_progress", { userId: 2 });
    await settleForTicket(db, 41, "resolved", { userId: 2, note: "Mechanic sent." });
    await settleForTicket(db, 41, "closed", { userId: 2 });
    await settleForTicket(db, 41, "open");
    assert.match(calls[0].sql, /status = 'acknowledged'/);
    assert.match(calls[1].sql, /status = 'resolved'/);
    assert.equal(calls[1].params[1], "Mechanic sent.");
    assert.equal(calls[2].params[1], "Request closed.");
    assert.match(calls[3].sql, /SET status = 'open'/);
    assert.ok(calls.every((c) => /source_kind = 'support'/.test(c.sql)), "an exception that came from a pause is never moved by its ticket");
  });
});

/* ---- the Exceptions panel ---- */

test("exceptions nobody on the driver side raised are left entirely to the existing handlers", async () => {
  await withDb(() => [[{ id: 5, status: "open", sourceKind: null, sourceId: null, tripId: 31 }]], async () => {
    assert.deepEqual(await bridge.acknowledge({ context, user: staff, exceptionId: 5 }), { handled: false });
    assert.deepEqual(await bridge.resolve({ context, user: staff, exceptionId: 5, notes: "Fixed" }), { handled: false });
  });
});

test("a pause request is answered, not acknowledged — and cannot be resolved before it has been", async () => {
  const db_ = (pauseStatus) => (sql) => {
    if (sql.includes("FROM operational_exceptions")) return [[{ id: 5, status: "open", sourceKind: "pause", sourceId: 7, tripId: 31 }]];
    if (sql.includes("FROM trip_pauses WHERE pause_id = ?")) return [[{ id: 7, ticketId: 41, status: pauseStatus }]];
    return [[]];
  };
  await withDb(db_("pending"), async () => {
    const ack = await bridge.acknowledge({ context, user: staff, exceptionId: 5 });
    assert.equal(ack.handled, true);
    assert.equal(ack.status, 409);
    assert.match(ack.body.message, /Approve or decline/);

    const res = await bridge.resolve({ context, user: staff, exceptionId: 5, notes: "Fixed" });
    assert.equal(res.status, 409);
    assert.match(res.body.message, /waiting for an answer/);
  });
});

test("the panel only ever reads the report of an exception in the branch being operated in", async () => {
  await withDb(() => [[]], async (calls) => {
    const result = await bridge.driverReport(context, 5);
    assert.equal(result.missing, true);
    assert.deepEqual(calls[0].params, [5, 7, 3]);
    assert.match(calls[0].sql, /company_id = \? AND branch_id = \?/);
  });
  await withDb(() => [[{ id: 5, status: "open", sourceKind: null, sourceId: null, tripId: null }]], async () => {
    assert.deepEqual(await bridge.driverReport(context, 5), { report: null }, "an ordinary exception has no driver report");
  });
});

/* ---- the conversation behind an exception ---- */

test("the conversation is only read for an exception a driver filed, in this branch", async () => {
  await withDb(() => [[]], async (calls) => {
    assert.equal((await bridge.thread(context, 5)).missing, true);
    assert.deepEqual(calls[0].params, [5, 7, 3]);
  });
  await withDb(() => [[{ id: 5, status: "open", sourceKind: null, sourceId: null, tripId: 31 }]], async () => {
    assert.deepEqual(await bridge.thread(context, 5), { thread: null }, "an ordinary exception has no conversation");
  });
});

test("the office cannot write to nobody: an exception no driver filed has no one to answer", async () => {
  await withDb(() => [[{ id: 5, status: "open", sourceKind: null, sourceId: null, tripId: 31 }]], async (calls) => {
    const result = await bridge.replyToDriver({ context, user: staff, exceptionId: 5, body: "Hello" });
    assert.equal(result.status, 409);
    assert.match(result.error, /nobody to write to/);
    assert.ok(calls.every((c) => !/INSERT/i.test(c.sql)), "nothing is written");
  });
  await withDb(() => [[]], async () => {
    const result = await bridge.replyToDriver({ context, user: staff, exceptionId: 5, body: "Hello" });
    assert.equal(result.status, 404);
  });
});

test("a reply on a pause request goes to that pause's own ticket, not to the pause's number", async () => {
  const handler = (sql) => {
    if (sql.includes("FROM operational_exceptions")) return [[{ id: 5, status: "acknowledged", sourceKind: "pause", sourceId: 7, tripId: 31 }]];
    if (sql.includes("FROM trip_pauses WHERE pause_id = ?")) return [[{ id: 7, ticketId: 41, status: "approved" }]];
    return [[]];
  };
  await withDb(handler, async (calls) => {
    await bridge.replyToDriver({ context, user: staff, exceptionId: 5, body: "Help is on the way" });
    const lookup = calls.find((c) => /FROM support_tickets WHERE ticket_id = ?/.test(c.sql));
    assert.ok(lookup, "the ticket was looked up");
    assert.equal(lookup.params[0], 41, "by the ticket's number, not the pause's (7)");
  });
  // a pause whose ticket is gone is reported, not guessed at
  await withDb((sql) => {
    if (sql.includes("FROM operational_exceptions")) return [[{ id: 5, status: "open", sourceKind: "pause", sourceId: 7, tripId: 31 }]];
    return [[]];
  }, async () => {
    const result = await bridge.replyToDriver({ context, user: staff, exceptionId: 5, body: "Hello" });
    assert.equal(result.status, 404);
  });
});
