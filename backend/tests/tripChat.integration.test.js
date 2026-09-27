import "../src/config/env.js";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import db from "../src/config/db.js";
import * as chat from "../src/modules/chat/tripChat.controller.js";

/**
 * Trip chat against the real database: who can reach a thread, that a
 * replayed send does not post twice, that unread counts move, and that a
 * closed trip's thread is read-only.
 *
 * Fixtures are found, not hard-coded, and everything written is removed.
 */

const q = async (sql, params = []) => (await db.execute(sql, params))[0];
const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

let open;
let closed;
let driverless;
let stranger;
let staffUserId;
let firstNewId;
let readsBefore;

before(async () => {
  [open] = await q(
    `SELECT tt.trip_ticket_id AS tripId, tt.company_id AS companyId, tt.branch_id AS branchId, ta.driver_id AS driverId
       FROM trip_tickets tt
       JOIN trip_assignments ta ON ta.trip_ticket_id = tt.trip_ticket_id AND ta.is_current = TRUE
      WHERE tt.status IN ('assigned','accepted','released','in_transit','delivered') LIMIT 1`
  );
  [closed] = await q(
    `SELECT tt.trip_ticket_id AS tripId, tt.company_id AS companyId, tt.branch_id AS branchId, ta.driver_id AS driverId
       FROM trip_tickets tt
       JOIN trip_assignments ta ON ta.trip_ticket_id = tt.trip_ticket_id AND ta.is_current = TRUE
      WHERE tt.status IN ('operationally_closed','cancelled') LIMIT 1`
  );
  [driverless] = await q(
    `SELECT tt.trip_ticket_id AS tripId, tt.company_id AS companyId, tt.branch_id AS branchId
       FROM trip_tickets tt
       LEFT JOIN trip_assignments ta ON ta.trip_ticket_id = tt.trip_ticket_id AND ta.is_current = TRUE
      WHERE ta.trip_ticket_id IS NULL AND tt.status NOT IN ('operationally_closed','cancelled') LIMIT 1`
  );
  if (open) {
    [stranger] = await q(
      `SELECT driver_id AS driverId FROM drivers
        WHERE company_id = ? AND driver_id <> ?
          AND driver_id NOT IN (SELECT driver_id FROM trip_assignments WHERE trip_ticket_id = ? AND is_current = TRUE)
        LIMIT 1`,
      [open.companyId, open.driverId, open.tripId]
    );
    const [admin] = await q(
      `SELECT u.user_id AS userId FROM users u
         JOIN user_company_access uca ON uca.user_id = u.user_id AND uca.company_id = ?
        LIMIT 1`,
      [open.companyId]
    );
    staffUserId = admin?.userId;
  }
  const [[{ maxId }]] = await db.execute("SELECT COALESCE(MAX(message_id), 0) AS maxId FROM trip_messages");
  firstNewId = Number(maxId) + 1;
  readsBefore = await q("SELECT * FROM trip_message_reads");
});

after(async () => {
  await db.execute("DELETE FROM trip_messages WHERE message_id >= ?", [firstNewId]);
  await db.execute("DELETE FROM trip_message_reads");
  for (const r of readsBefore || []) {
    await db.execute(
      "INSERT INTO trip_message_reads (trip_ticket_id, reader_kind, reader_id, last_read_message_id) VALUES (?, ?, ?, ?)",
      [r.trip_ticket_id, r.reader_kind, r.reader_id, r.last_read_message_id]
    );
  }
  await db.end();
});

const asDriver = (driverId, companyId, tripId, body = {}, query = {}) => ({
  params: { id: tripId },
  body,
  query,
  driver: { driverId, companyId, name: "Test Driver" },
});
const asStaff = (trip, body = {}, query = {}, branchId = trip.branchId) => ({
  params: { id: trip.tripId },
  body,
  query,
  user: { userId: staffUserId },
  context: { companyId: trip.companyId, branchId },
});

const call = async (handler, req) => {
  const res = response();
  await handler(req, res);
  return res;
};

test("driver and dispatch can talk about a trip, and unread counts follow", async (t) => {
  if (!open || !staffUserId) return t.skip("no open trip with a driver in this database");

  const sent = await call(chat.driverSend, asDriver(open.driverId, open.companyId, open.tripId,
    { body: "  Nasa gate na po, sarado pa.  ", clientRef: "test-ref-0001" }));
  assert.equal(sent.statusCode, 201);
  assert.equal(sent.body.data.body, "Nasa gate na po, sarado pa.", "trimmed");
  assert.equal(sent.body.data.mine, true);

  const staffView = await call(chat.staffList, asStaff(open));
  assert.equal(staffView.statusCode, 200);
  const mine = staffView.body.data.messages.find((m) => m.id === sent.body.data.id);
  assert.equal(mine.mine, false, "the driver's message is not the dispatcher's");
  assert.equal(mine.senderKind, "driver");
  assert.equal("senderDriverId" in mine, false, "internal ids are not exposed");

  const unread = await call(chat.staffUnreadSummary, asStaff(open));
  assert.equal(unread.body.data.find((r) => r.tripId === open.tripId)?.unread, 1);

  await call(chat.staffRead, asStaff(open, { lastMessageId: sent.body.data.id }));
  const afterRead = await call(chat.staffUnreadSummary, asStaff(open));
  assert.equal(afterRead.body.data.find((r) => r.tripId === open.tripId), undefined);

  const reply = await call(chat.staffSend, asStaff(open, { body: "Sige, tatawagan ko ang guard." }));
  assert.equal(reply.statusCode, 201);
  const driverUnread = await call(chat.driverUnreadSummary, asDriver(open.driverId, open.companyId, open.tripId));
  assert.equal(driverUnread.body.data.find((r) => r.tripId === open.tripId)?.unread, 1);

  // Only what came after what the phone already has.
  const since = await call(chat.driverList, asDriver(open.driverId, open.companyId, open.tripId, {}, { after: sent.body.data.id }));
  assert.deepEqual(since.body.data.messages.map((m) => m.body), ["Sige, tatawagan ko ang guard."]);
  assert.equal(since.body.data.messages[0].mine, false);
});

test("a message replayed from the phone's outbox is stored once", async (t) => {
  if (!open) return t.skip("no open trip with a driver in this database");
  const req = () => asDriver(open.driverId, open.companyId, open.tripId, { body: "Traffic sa SLEX", clientRef: "test-ref-0002" });
  const first = await call(chat.driverSend, req());
  const again = await call(chat.driverSend, req());
  assert.equal(first.statusCode, 201);
  assert.equal(again.statusCode, 200);
  assert.equal(again.body.data.id, first.body.data.id);
  const [[{ n }]] = await db.execute(
    "SELECT COUNT(*) AS n FROM trip_messages WHERE trip_ticket_id = ? AND client_ref = 'test-ref-0002'",
    [open.tripId]
  );
  assert.equal(Number(n), 1);
});

test("nobody reaches a thread that is not theirs", async (t) => {
  if (!open || !stranger) return t.skip("fixtures missing");
  const other = await call(chat.driverSend, asDriver(stranger.driverId, open.companyId, open.tripId, { body: "hello" }));
  assert.equal(other.statusCode, 404, "another driver");
  const otherList = await call(chat.driverList, asDriver(stranger.driverId, open.companyId, open.tripId));
  assert.equal(otherList.statusCode, 404);
  const otherCompany = await call(chat.driverList, asDriver(open.driverId, open.companyId + 100000, open.tripId));
  assert.equal(otherCompany.statusCode, 404, "same driver id, another company");
  const otherBranch = await call(chat.staffList, asStaff(open, {}, {}, open.branchId + 100000));
  assert.equal(otherBranch.statusCode, 404, "staff in another branch");
});

test("a closed trip's thread is read-only, and a trip with no driver has nobody to message", async (t) => {
  if (closed) {
    const d = await call(chat.driverSend, asDriver(closed.driverId, closed.companyId, closed.tripId, { body: "hello" }));
    assert.equal(d.statusCode, 409);
    const read = await call(chat.driverList, asDriver(closed.driverId, closed.companyId, closed.tripId));
    assert.equal(read.statusCode, 200);
    assert.equal(read.body.data.closed, true);
  }
  if (driverless && staffUserId) {
    const s = await call(chat.staffSend, asStaff(driverless, { body: "hello" }));
    assert.equal(s.statusCode, 409);
    assert.match(s.body.message, /No driver is assigned/);
  }
  if (!closed && !driverless) t.skip("fixtures missing");
});

test("empty and oversized messages are refused with a reason", async (t) => {
  if (!open) return t.skip("no open trip with a driver in this database");
  const empty = await call(chat.driverSend, asDriver(open.driverId, open.companyId, open.tripId, { body: "   " }));
  assert.equal(empty.statusCode, 400);
  assert.match(empty.body.message, /Type a message/);
  const long = await call(chat.driverSend, asDriver(open.driverId, open.companyId, open.tripId, { body: "x".repeat(1001) }));
  assert.equal(long.statusCode, 400);
  assert.match(long.body.message, /1000 characters/);
});
