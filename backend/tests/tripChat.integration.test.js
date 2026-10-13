import "../src/config/env.js";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import db from "../src/config/db.js";
import { UPLOAD_ROOT } from "../src/modules/finance/receipts.storage.js";
import { findPhoto } from "../src/modules/chat/tripChat.service.js";
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
  const unreadRow = unread.body.data.find((r) => r.tripId === open.tripId);
  assert.equal(unreadRow?.unread, 1);
  // the list can show what was said, and when, without opening the conversation
  assert.equal(unreadRow.lastMessage.body, "Nasa gate na po, sarado pa.");
  assert.equal(unreadRow.lastMessage.hasPhoto, false);
  assert.ok(unreadRow.lastMessage.createdAt);

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

/* ---------------------------------------------------------------- */
/* Photos                                                           */
/* ---------------------------------------------------------------- */

const written = [];
after(() => { for (const file of written) fs.rmSync(file, { force: true }); });

/** What multer leaves behind: a real file under the upload root. */
function uploaded(name) {
  const dir = path.join(UPLOAD_ROOT, "chat", "test");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}-${Date.now()}.jpg`);
  fs.writeFileSync(file, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
  written.push(file);
  return { path: file, mimetype: "image/jpeg", size: 7, originalname: "receipt.jpg" };
}
const withFile = (req, file) => ({ ...req, file });
/** discard() unlinks in the background, so allow it a moment before calling a file kept. */
const removed = async (file) => {
  for (let i = 0; i < 20 && fs.existsSync(file); i += 1) await new Promise((r) => setTimeout(r, 25));
  return !fs.existsSync(file);
};

test("a driver's photo is stored with the message, shown to both sides, and its location never leaves the server", async (t) => {
  if (!open || !staffUserId) return t.skip("no open trip with a driver in this database");
  const file = uploaded("pod");
  const sent = await call(chat.driverSendPhoto, withFile(
    asDriver(open.driverId, open.companyId, open.tripId, { body: "  Pirmado na po  ", clientRef: "test-photo-0001" }), file));
  assert.equal(sent.statusCode, 201);
  assert.equal(sent.body.data.hasPhoto, true);
  assert.equal(sent.body.data.body, "Pirmado na po", "caption trimmed");
  assert.equal(sent.body.data.mine, true);
  assert.equal(JSON.stringify(sent.body).includes(path.basename(file.path)), false, "no storage path in the reply");
  assert.equal(fs.existsSync(file.path), true, "the photo is kept");

  const staffView = await call(chat.staffList, asStaff(open));
  const theirs = staffView.body.data.messages.find((m) => m.id === sent.body.data.id);
  assert.equal(theirs.hasPhoto, true);
  assert.equal(JSON.stringify(staffView.body).includes(path.basename(file.path)), false);

  const driverView = await call(chat.driverList, asDriver(open.driverId, open.companyId, open.tripId));
  assert.equal(driverView.body.data.messages.find((m) => m.id === sent.body.data.id).hasPhoto, true);

  const plain = await call(chat.driverSend, asDriver(open.driverId, open.companyId, open.tripId, { body: "walang litrato" }));
  assert.equal(plain.body.data.hasPhoto, false);
});

test("a photo can go without words, and a photo message counts as unread for dispatch", async (t) => {
  if (!open || !staffUserId) return t.skip("no open trip with a driver in this database");
  const before = (await call(chat.staffUnreadSummary, asStaff(open))).body.data.find((r) => r.tripId === open.tripId)?.unread ?? 0;
  const sent = await call(chat.driverSendPhoto, withFile(
    asDriver(open.driverId, open.companyId, open.tripId, { clientRef: "test-photo-0002" }), uploaded("nocaption")));
  assert.equal(sent.statusCode, 201);
  assert.equal(sent.body.data.body, "");
  const unreadNow = (await call(chat.staffUnreadSummary, asStaff(open))).body.data.find((r) => r.tripId === open.tripId)?.unread;
  assert.equal(unreadNow, before + 1);
});

test("a photo replayed from the outbox is stored once, and the second copy is not kept", async (t) => {
  if (!open) return t.skip("no open trip with a driver in this database");
  const first = uploaded("replay-a");
  const second = uploaded("replay-b");
  const req = (file) => withFile(
    asDriver(open.driverId, open.companyId, open.tripId, { body: "Resibo", clientRef: "test-photo-0003" }), file);
  const a = await call(chat.driverSendPhoto, req(first));
  const b = await call(chat.driverSendPhoto, req(second));
  assert.equal(a.statusCode, 201);
  assert.equal(b.statusCode, 200);
  assert.equal(b.body.data.id, a.body.data.id);
  assert.equal(fs.existsSync(first.path), true);
  assert.equal(await removed(second.path), true, "the duplicate upload is removed");
});

test("a photo is refused, and the file removed, when there is no photo, the caption is too long, or the trip is not theirs or is closed", async (t) => {
  if (!open) return t.skip("no open trip with a driver in this database");
  const none = await call(chat.driverSendPhoto, asDriver(open.driverId, open.companyId, open.tripId, {}));
  assert.equal(none.statusCode, 400);
  assert.match(none.body.message, /Choose a photo/);

  const long = uploaded("long");
  const tooLong = await call(chat.driverSendPhoto, withFile(
    asDriver(open.driverId, open.companyId, open.tripId, { body: "x".repeat(1001) }), long));
  assert.equal(tooLong.statusCode, 400);
  assert.equal(await removed(long.path), true);

  if (stranger) {
    const theirs = uploaded("stranger");
    const other = await call(chat.driverSendPhoto, withFile(
      asDriver(stranger.driverId, open.companyId, open.tripId, {}), theirs));
    assert.equal(other.statusCode, 404);
    assert.equal(await removed(theirs.path), true);
  }
  if (closed) {
    const late = uploaded("closed");
    const res = await call(chat.driverSendPhoto, withFile(
      asDriver(closed.driverId, closed.companyId, closed.tripId, {}), late));
    assert.equal(res.statusCode, 409);
    assert.equal(await removed(late.path), true);
  }
});

test("a photo can be fetched only through the trip it was sent on", async (t) => {
  if (!open || !staffUserId) return t.skip("no open trip with a driver in this database");
  const sent = await call(chat.driverSendPhoto, withFile(
    asDriver(open.driverId, open.companyId, open.tripId, { clientRef: "test-photo-0004" }), uploaded("scope")));
  const id = sent.body.data.id;
  const fetchAs = (handler, req) => call(handler, { ...req, params: { ...req.params, messageId: id } });

  assert.ok(await findPhoto(open.tripId, id), "found on its own trip");
  assert.equal(await findPhoto(open.tripId + 100000, id), null, "not on another trip");
  assert.equal(await findPhoto(open.tripId, "abc"), null);

  if (stranger) {
    const other = await fetchAs(chat.driverPhoto, asDriver(stranger.driverId, open.companyId, open.tripId));
    assert.equal(other.statusCode, 404, "another driver");
  }
  const otherBranch = await fetchAs(chat.staffPhoto, asStaff(open, {}, {}, open.branchId + 100000));
  assert.equal(otherBranch.statusCode, 404, "staff in another branch");

  const text = await call(chat.driverSend, asDriver(open.driverId, open.companyId, open.tripId, { body: "text lang" }));
  const noPhoto = await call(chat.driverPhoto, {
    ...asDriver(open.driverId, open.companyId, open.tripId),
    params: { id: open.tripId, messageId: text.body.data.id },
  });
  assert.equal(noPhoto.statusCode, 404, "a message with no photo has nothing to serve");
});
