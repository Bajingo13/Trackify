import "../../config/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import db from "../../config/db.js";
import { acknowledge, driverReport, replyToDriver, resolve, thread } from "./exceptionBridge.service.js";

/**
 * An exception raised by a pre-trip inspection carries the inspection's id as
 * its source_id. Before this, anything that was not a pause was taken for a
 * Help & Support request — so that id would have been looked up, answered and
 * closed as somebody's request. These keep the two apart.
 */

const CONTEXT = { companyId: 7, branchId: 222 };
const USER = { userId: 3, name: "Fleet Manager" };

function withException(sourceKind, fn) {
  const saved = db.execute;
  const queries = [];
  db.execute = async (sql, params) => {
    queries.push(sql);
    if (/FROM operational_exceptions/.test(sql)) {
      return [[{ id: 12, status: "open", sourceKind, sourceId: 5, tripId: 41 }]];
    }
    return [[]];
  };
  return Promise.resolve(fn(queries)).finally(() => { db.execute = saved; });
}

const touchesRequests = (queries) => queries.some((q) => /support_tickets|support_messages/.test(q));

test("its report points to the inspection, and no request is looked up", async () => {
  await withException("inspection", async (queries) => {
    assert.deepEqual(await driverReport(CONTEXT, 12), { report: { kind: "inspection", inspectionId: 5 } });
    assert.equal(touchesRequests(queries), false);
  });
});

test("it cannot be resolved from the Exceptions panel; Fleet settles it", async () => {
  await withException("inspection", async (queries) => {
    const out = await resolve({ context: CONTEXT, user: USER, exceptionId: 12, notes: "done" });
    assert.equal(out.handled, true);
    assert.equal(out.status, 409);
    assert.match(out.body.message, /Fleet → Inspections/);
    assert.equal(touchesRequests(queries), false);
  });
});

test("acknowledging it is an ordinary acknowledgement, with no request taken on", async () => {
  await withException("inspection", async (queries) => {
    const out = await acknowledge({ context: CONTEXT, user: USER, exceptionId: 12 });
    assert.equal(out.handled, false);
    assert.equal(touchesRequests(queries), false);
  });
});

test("it has no conversation to read or write to", async () => {
  await withException("inspection", async (queries) => {
    assert.deepEqual(await thread(CONTEXT, 12), { thread: null });
    const out = await replyToDriver({ context: CONTEXT, user: USER, exceptionId: 12, body: "Hello" });
    assert.equal(out.status, 409);
    assert.equal(touchesRequests(queries), false);
  });
});

test("an unknown source is never taken for a request either", async () => {
  await withException("something_new", async (queries) => {
    assert.deepEqual(await driverReport(CONTEXT, 12), { report: null });
    assert.equal((await acknowledge({ context: CONTEXT, user: USER, exceptionId: 12 })).handled, false);
    assert.equal(touchesRequests(queries), false);
  });
});
