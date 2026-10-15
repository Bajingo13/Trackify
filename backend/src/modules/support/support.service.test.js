import "../../config/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import db from "../../config/db.js";
import {
  MAX_OPEN_PER_DRIVER, checkBody, checkClientRef, checkSubject, createForDriver, getForDriver,
  REOPEN_DAYS, getForStaff, listForStaff, reopenForDriver, replyAsDriver, replyAsStaff, ticketNo, updateAsStaff,
} from "./support.service.js";

/**
 * Driver Help & Support.
 *
 * What these guard is who can reach what. A driver reaches only their own
 * requests and may only link one to a trip they were on; staff reach only the
 * branch they are operating in; and a replayed send from a phone out of signal
 * is stored once. The wording and the screens are covered elsewhere.
 */

const norm = (sql) => String(sql).replace(/\s+/g, " ").trim();

async function withDb(handler, fn) {
  const real = { execute: db.execute, getConnection: db.getConnection };
  const calls = [];
  const run = async (sql, params) => {
    calls.push({ sql: norm(sql), params });
    const q = norm(sql);
    // the exception that follows a request, and the check for a pause it may hold:
    // both are covered in pause.service.test.js, so here they simply answer
    if (q.includes("operational_exceptions")) return [{}];
    if (q.includes("FROM trip_pauses WHERE ticket_id")) return [[]];
    return handler(q, params);
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
const ticketRow = (extra = {}) => ({
  id: 41, companyId: 7, branchId: 3, driverId: 9, driverName: "Juan Dela Cruz", tripId: null, tripNo: null,
  category: "vehicle", priority: "normal", subject: "Flat tyre", status: "open",
  assignedUserId: null, assignedName: null, createdAt: "2026-10-14", updatedAt: "2026-10-14", resolvedAt: null,
  driverLastRead: 0, staffLastRead: 0, lastMessageId: 1, lastStaffMessageId: null, lastDriverMessageId: 1,
  lastBody: "I have a flat tyre", lastSender: "driver", ...extra,
});

/* ---- validation ---- */

test("a request needs a title and a message, and both are bounded", () => {
  assert.match(checkSubject("  ").error, /short title/);
  assert.match(checkSubject("ab").error, /at least 3/);
  assert.match(checkSubject("x".repeat(121)).error, /under 120/);
  assert.equal(checkSubject("  Flat   tyre  ").subject, "Flat tyre");
  assert.match(checkBody("   ").error, /Write your message/);
  assert.match(checkBody("x".repeat(2001)).error, /under 2000/);
  assert.equal(checkBody("  help \r\n me ").body, "help \n me");
});

test("a device reference is kept only if it looks like one, and the number is padded", () => {
  assert.equal(checkClientRef("abc-12345_xyz"), "abc-12345_xyz");
  assert.equal(checkClientRef("short"), null);
  assert.equal(checkClientRef("has spaces in it!"), null);
  assert.equal(checkClientRef(undefined), null);
  assert.equal(ticketNo(42), "SUP-000042");
});

/* ---- a driver filing a request ---- */

test("an unknown category is refused before anything is written", async () => {
  await withDb(() => { throw new Error("nothing should be queried"); }, async (calls) => {
    const result = await createForDriver({ driver, input: { category: "gossip", subject: "Hello there", message: "Hi" } });
    assert.equal(result.status, 400);
    assert.match(result.error, /what your request is about/);
    assert.equal(calls.length, 0);
  });
});

test("a request cannot be linked to a trip the driver was never on", async () => {
  await withDb(
    (sql) => {
      if (sql.includes("FROM trip_assignments")) return [[]];
      throw new Error(`unexpected: ${sql}`);
    },
    async (calls) => {
      const result = await createForDriver({
        driver,
        input: { category: "trip", subject: "Wrong address", message: "The address is wrong", tripId: 555 },
      });
      assert.equal(result.status, 404);
      // the lookup is by this driver AND this company, so another driver's trip finds nothing
      assert.deepEqual(calls[0].params, [9, 7, 555]);
    }
  );
});

test("a driver with no branch cannot file, and is told why in words they can use", async () => {
  await withDb(() => [[]], async () => {
    const result = await createForDriver({
      driver: { ...driver, branchId: null },
      input: { category: "app", subject: "Cannot sign in", message: "It says no" },
    });
    assert.equal(result.status, 409);
    assert.match(result.error, /supervisor/);
  });
});

test("there is a ceiling on how many open requests one driver can have", async () => {
  await withDb(
    (sql) => {
      if (sql.includes("COUNT(*) AS n FROM support_tickets")) return [[{ n: MAX_OPEN_PER_DRIVER }]];
      throw new Error(`unexpected: ${sql}`);
    },
    async () => {
      const result = await createForDriver({ driver, input: { category: "other", subject: "Another one", message: "More" } });
      assert.equal(result.status, 429);
    }
  );
});

test("a request is stored with its first message in one transaction, under the driver's company and branch", async () => {
  await withDb(
    (sql) => {
      if (sql.includes("AND client_ref = ?")) return [[]]; // not filed before
      if (sql.includes("tt.status = 'in_transit'")) return [[]]; // on no delivery right now
      if (sql.includes("COUNT(*) AS n FROM support_tickets")) return [[{ n: 0 }]];
      if (sql.startsWith("INSERT INTO support_tickets")) return [{ insertId: 41 }];
      if (sql.startsWith("INSERT INTO support_messages")) return [{ insertId: 1 }];
      if (sql.startsWith("UPDATE support_tickets")) return [{}];
      if (sql.includes("FROM support_tickets t")) return [[ticketRow()]];
      if (sql.includes("FROM support_messages")) {
        return [[{ id: 1, ticketId: 41, senderKind: "driver", senderDriverId: 9, senderName: "Juan Dela Cruz", body: "I have a flat tyre", createdAt: "2026-10-14" }]];
      }
      throw new Error(`unexpected: ${sql}`);
    },
    async (calls) => {
      const result = await createForDriver({
        driver,
        input: { category: "vehicle", subject: "Flat tyre", message: "I have a flat tyre", urgent: true, clientRef: "abcd1234efgh" },
      });
      assert.equal(result.duplicate, false);
      assert.equal(result.ticket.ticketNo, "SUP-000041");
      assert.equal(result.ticket.messages.length, 1);
      assert.equal(result.ticket.messages[0].mine, true);

      const sqls = calls.map((c) => c.sql);
      const begin = sqls.indexOf("BEGIN");
      const commit = sqls.indexOf("COMMIT");
      const insertTicket = sqls.findIndex((s) => s.startsWith("INSERT INTO support_tickets"));
      const insertMessage = sqls.findIndex((s) => s.startsWith("INSERT INTO support_messages"));
      assert.ok(begin >= 0 && begin < insertTicket && insertTicket < insertMessage && insertMessage < commit);
      // company and branch come from the authenticated driver, urgency from the form
      const params = calls[insertTicket].params;
      assert.equal(params[0], 7);
      assert.equal(params[1], 3);
      assert.equal(params[2], 9);
      assert.equal(params[6], "urgent");
    }
  );
});

test("a replay of the same send returns the request already filed instead of filing it twice", async () => {
  await withDb(
    (sql) => {
      if (sql.includes("WHERE driver_id = ? AND client_ref = ?")) return [[{ id: 41 }]];
      if (sql.includes("FROM support_tickets t")) return [[ticketRow()]];
      if (sql.includes("FROM support_messages")) return [[]];
      if (sql.startsWith("UPDATE support_tickets")) return [{}];
      throw new Error(`unexpected: ${sql}`);
    },
    async (calls) => {
      const result = await createForDriver({
        driver,
        input: { category: "vehicle", subject: "Flat tyre", message: "I have a flat tyre", clientRef: "abcd1234efgh" },
      });
      assert.equal(result.duplicate, true);
      assert.equal(result.ticket.id, 41);
      assert.ok(!calls.some((c) => c.sql.startsWith("INSERT")), "nothing was inserted");
    }
  );
});

/* ---- a driver reading and writing their own ---- */

test("a driver cannot open another driver's request", async () => {
  await withDb(() => [[]], async (calls) => {
    const ticket = await getForDriver({ driver, id: 41 });
    assert.equal(ticket, null);
    assert.deepEqual(calls[0].params, [41, 9, 7]);
    assert.match(calls[0].sql, /t\.driver_id = \? AND t\.company_id = \?/);
  });
});

test("an answer is unread until the driver opens the request", async () => {
  const unread = ticketRow({ lastMessageId: 2, lastStaffMessageId: 2, driverLastRead: 1 });
  await withDb(
    (sql) => {
      if (sql.includes("FROM support_tickets t")) return [[unread]];
      if (sql.includes("FROM support_messages")) return [[]];
      if (sql.startsWith("UPDATE support_tickets")) return [{}];
      throw new Error(`unexpected: ${sql}`);
    },
    async (calls) => {
      const ticket = await getForDriver({ driver, id: 41 });
      // reading it hands back the read state, and records that it was read
      assert.equal(ticket.unread, false);
      const mark = calls.find((c) => c.sql.startsWith("UPDATE support_tickets SET driver_last_read_message_id"));
      assert.ok(mark, "the answers were marked read");
      assert.equal(mark.params[0], 2);
    }
  );
});

test("a driver cannot write on a closed request", async () => {
  await withDb(
    (sql) => (sql.includes("FROM support_tickets") ? [[{ id: 41, branchId: 3, status: "closed" }]] : []),
    async () => {
      const result = await replyAsDriver({ driver, id: 41, input: { body: "Still there?" } });
      assert.equal(result.status, 409);
      assert.match(result.error, /closed/);
    }
  );
});

test("writing on a resolved request reopens it", async () => {
  await withDb(
    (sql) => {
      if (sql.startsWith("SELECT ticket_id AS id, branch_id")) return [[{ id: 41, branchId: 3, status: "resolved" }]];
      if (sql.startsWith("INSERT INTO support_messages")) return [{ insertId: 5 }];
      if (sql.startsWith("UPDATE support_tickets")) return [{}];
      if (sql.includes("FROM support_messages")) {
        return [[{ id: 5, ticketId: 41, senderKind: "driver", senderDriverId: 9, senderName: "Juan Dela Cruz", body: "It is still broken", createdAt: "x" }]];
      }
      throw new Error(`unexpected: ${sql}`);
    },
    async (calls) => {
      const result = await replyAsDriver({ driver, id: 41, input: { body: "It is still broken" } });
      assert.equal(result.message.body, "It is still broken");
      const reopen = calls.find((c) => c.sql.includes("status = IF(status = 'resolved', 'open', status)"));
      assert.ok(reopen, "the request was reopened");
    }
  );
});

/* ---- staff ---- */

test("staff see only the branch they are operating in", async () => {
  await withDb(
    (sql) => (sql.includes("GROUP BY status") ? [[{ status: "open", n: 2 }]] : [[ticketRow()]]),
    async (calls) => {
      const { tickets, counts } = await listForStaff({ companyId: 7, branchId: 3 }, { status: "active", q: "tyre" });
      assert.equal(tickets.length, 1);
      assert.equal(tickets[0].driverName, "Juan Dela Cruz");
      assert.equal(counts.open, 2);
      const list = calls[0];
      assert.match(list.sql, /t\.company_id = \? AND t\.branch_id = \?/);
      assert.deepEqual(list.params.slice(0, 2), [7, 3]);
      // a search term is a LIKE parameter, never part of the SQL text
      assert.ok(!list.sql.includes("tyre"));
    }
  );
});

test("a request from another branch is simply not found by staff", async () => {
  await withDb(() => [[]], async (calls) => {
    assert.equal(await getForStaff({ companyId: 7, branchId: 3, id: 41 }), null);
    assert.deepEqual(calls[0].params, [41, 7, 3]);

    const reply = await replyAsStaff({
      context: { companyId: 7, branchId: 3 }, user: { userId: 2, name: "Ana" }, id: 41, input: { body: "On it" },
    });
    assert.equal(reply.status, 404);
    const update = await updateAsStaff({ context: { companyId: 7, branchId: 3 }, user: { userId: 2 }, id: 41, input: { status: "resolved" } });
    assert.equal(update.status, 404);
  });
});

test("replying to an open request takes it on", async () => {
  await withDb(
    (sql) => {
      if (sql.startsWith("SELECT ticket_id AS id, status")) return [[{ id: 41, status: "open", assignedUserId: null }]];
      if (sql.startsWith("INSERT INTO support_messages")) return [{ insertId: 6 }];
      if (sql.startsWith("UPDATE support_tickets")) return [{}];
      if (sql.includes("FROM support_messages")) {
        return [[{ id: 6, ticketId: 41, senderKind: "staff", senderUserId: 2, senderName: "Ana Reyes", body: "On my way", createdAt: "x" }]];
      }
      throw new Error(`unexpected: ${sql}`);
    },
    async (calls) => {
      const result = await replyAsStaff({
        context: { companyId: 7, branchId: 3 }, user: { userId: 2, name: "Ana Reyes" }, id: 41, input: { body: "On my way" },
      });
      assert.equal(result.message.mine, true);
      const take = calls.find((c) => c.sql.includes("status = IF(status = 'open', 'in_progress', status)"));
      assert.ok(take, "an open request moved to in progress");
      assert.deepEqual(take.params.slice(0, 2), [2, "Ana Reyes"]);
    }
  );
});

test("staff cannot reply on a closed request, nor set a status that does not exist", async () => {
  await withDb(
    (sql) => (sql.startsWith("SELECT ticket_id AS id, status") ? [[{ id: 41, status: "closed" }]] : []),
    async () => {
      const closed = await replyAsStaff({
        context: { companyId: 7, branchId: 3 }, user: { userId: 2 }, id: 41, input: { body: "Hello" },
      });
      assert.equal(closed.status, 409);
      const bad = await updateAsStaff({ context: { companyId: 7, branchId: 3 }, user: { userId: 2 }, id: 41, input: { status: "banished" } });
      assert.equal(bad.status, 400);
    }
  );
});

test("resolving stamps when it was resolved, and reopening clears it", async () => {
  const detail = ticketRow({ status: "resolved" });
  await withDb(
    (sql) => {
      if (sql.startsWith("SELECT ticket_id AS id, status")) return [[{ id: 41, status: "in_progress" }]];
      if (sql.startsWith("UPDATE support_tickets")) return [{}];
      if (sql.includes("FROM support_tickets t")) return [[detail]];
      if (sql.includes("FROM support_messages")) return [[]];
      throw new Error(`unexpected: ${sql}`);
    },
    async (calls) => {
      const done = await updateAsStaff({ context: { companyId: 7, branchId: 3 }, user: { userId: 2 }, id: 41, input: { status: "resolved" } });
      assert.equal(done.from, "in_progress");
      assert.equal(done.to, "resolved");
      assert.ok(calls.some((c) => c.sql.includes("resolved_at = NOW(3)")));
    }
  );
  await withDb(
    (sql) => {
      if (sql.startsWith("SELECT ticket_id AS id, status")) return [[{ id: 41, status: "resolved" }]];
      if (sql.startsWith("UPDATE support_tickets")) return [{}];
      if (sql.includes("FROM support_tickets t")) return [[ticketRow()]];
      if (sql.includes("FROM support_messages")) return [[]];
      throw new Error(`unexpected: ${sql}`);
    },
    async (calls) => {
      await updateAsStaff({ context: { companyId: 7, branchId: 3 }, user: { userId: 2 }, id: 41, input: { status: "open" } });
      assert.ok(calls.some((c) => c.sql.includes("resolved_at = NULL")));
    }
  );
});

/* ---- reopening ---- */

const finished = (extra = {}) => ({ id: 41, branchId: 3, status: "resolved", resolvedAt: new Date(Date.now() - 2 * 86400000).toISOString(), pauses: 0, ...extra });
const reopenHandler = (row) => (q) => {
  if (q.includes("FROM support_tickets t WHERE t.ticket_id = ?")) return [row ? [row] : []];
  if (q.startsWith("UPDATE support_tickets")) return [{ affectedRows: 1 }];
  if (q.startsWith("INSERT INTO support_messages")) return [{ insertId: 77 }];
  if (q.includes("FROM support_messages WHERE message_id")) {
    return [[{ id: 77, ticketId: 41, senderKind: "driver", senderUserId: null, senderDriverId: 9, senderName: "Juan Dela Cruz", body: "Reopened this request.", clientRef: null, createdAt: "2026-10-14" }]];
  }
  return [[]];
};
const writes = (calls) => calls.filter((c) => /^(UPDATE|INSERT)/.test(c.sql) && !/operational_exceptions/.test(c.sql));

test("a driver can reopen a request that was resolved or closed, and the office is told in the thread", async () => {
  for (const status of ["resolved", "closed"]) {
    await withDb(reopenHandler(finished({ status })), async (calls) => {
      const result = await reopenForDriver({ driver, id: 41 });
      assert.deepEqual(result, { ticketId: 41 });
      const [update, insert] = writes(calls);
      assert.match(update.sql, /SET status = 'open', resolved_at = NULL WHERE ticket_id = \? AND status IN \('resolved', 'closed'\)/);
      assert.match(insert.sql, /INSERT INTO support_messages/);
      assert.deepEqual(insert.params, [41, 9, "Juan Dela Cruz", "Reopened this request."]);
    });
  }
});

test("only the driver's own request can be reopened, and only one that is finished", async () => {
  await withDb(reopenHandler(null), async (calls) => {
    const result = await reopenForDriver({ driver, id: 41 });
    assert.equal(result.status, 404);
    assert.deepEqual(calls[0].params, [41, 9, 7]);
    assert.equal(writes(calls).length, 0);
  });
  for (const status of ["open", "in_progress"]) {
    await withDb(reopenHandler(finished({ status })), async (calls) => {
      assert.equal((await reopenForDriver({ driver, id: 41 })).status, 409);
      assert.equal(writes(calls).length, 0);
    });
  }
});

test("a pause request is not reopened, and neither is one finished a long time ago", async () => {
  await withDb(reopenHandler(finished({ pauses: 1 })), async (calls) => {
    const result = await reopenForDriver({ driver, id: 41 });
    assert.equal(result.status, 409);
    assert.match(result.error, /send a new one/);
    assert.equal(writes(calls).length, 0);
  });
  const old = new Date(Date.now() - (REOPEN_DAYS + 1) * 86400000).toISOString();
  await withDb(reopenHandler(finished({ resolvedAt: old })), async (calls) => {
    const result = await reopenForDriver({ driver, id: 41 });
    assert.equal(result.status, 409);
    assert.match(result.error, new RegExp(`${REOPEN_DAYS} days`));
    assert.equal(writes(calls).length, 0);
  });
});

test("two taps reopen once: the second finds it already open and writes no second message", async () => {
  const handler = (q, p) => (q.startsWith("UPDATE support_tickets") ? [{ affectedRows: 0 }] : reopenHandler(finished())(q, p));
  await withDb(handler, async (calls) => {
    const result = await reopenForDriver({ driver, id: 41 });
    assert.equal(result.status, 409);
    assert.equal(calls.filter((c) => /^INSERT INTO support_messages/.test(c.sql)).length, 0);
  });
});

/* ---- a report from the road goes to the branch running the delivery ---- */

const filing = (road) => (sql) => {
  if (sql.includes("AND client_ref = ?")) return [[]];
  if (sql.includes("tt.status = 'in_transit'")) return [road];
  if (sql.includes("COUNT(*) AS n FROM support_tickets")) return [[{ n: 0 }]];
  if (sql.startsWith("INSERT INTO support_tickets")) return [{ insertId: 41 }];
  if (sql.startsWith("INSERT INTO support_messages")) return [{ insertId: 1 }];
  if (sql.startsWith("UPDATE support_tickets")) return [{}];
  if (sql.includes("FROM support_tickets t")) return [[ticketRow()]];
  if (sql.includes("FROM support_messages")) return [[{ id: 1, ticketId: 41, senderKind: "driver", senderDriverId: 9, senderName: "Juan", body: "x", createdAt: "2026-10-14" }]];
  return [{}];
};
const send = (category) => ({ category, subject: "Flat tyre", message: "I have a flat tyre", clientRef: "abcd1234efgh" });

test("a truck, road or safety report is filed with the delivery the driver is on, and its branch", async () => {
  // the driver's home branch is 3; the delivery they are driving belongs to branch 5
  await withDb(filing([{ id: 31, branchId: 5 }]), async (calls) => {
    await createForDriver({ driver, input: send("vehicle") });
    const insert = calls.find((c) => c.sql.startsWith("INSERT INTO support_tickets"));
    assert.equal(insert.params[1], 5, "the branch running the delivery, not the driver's home branch");
    assert.equal(insert.params[4], 31, "and linked to that delivery");
  });
});

test("other kinds of request stay with the driver's home branch, and so does a driver on two deliveries at once", async () => {
  await withDb(filing([{ id: 31, branchId: 5 }]), async (calls) => {
    await createForDriver({ driver, input: send("payment") });
    const insert = calls.find((c) => c.sql.startsWith("INSERT INTO support_tickets"));
    assert.equal(insert.params[1], 3, "a pay question is not about the road");
    assert.equal(calls.some((c) => c.sql.includes("tt.status = 'in_transit'")), false, "and does not even ask");
  });
  // two at once: guessing would send it to the wrong office, so it is not linked at all
  await withDb(filing([{ id: 31, branchId: 5 }, { id: 32, branchId: 6 }]), async (calls) => {
    await createForDriver({ driver, input: send("vehicle") });
    const insert = calls.find((c) => c.sql.startsWith("INSERT INTO support_tickets"));
    assert.equal(insert.params[1], 3);
    assert.equal(insert.params[4], null);
  });
});
