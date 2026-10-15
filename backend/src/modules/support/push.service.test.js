import "../../config/env.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import db from "../../config/db.js";
import { checkSubscription, notifyDriver, pushEnabled, removeSubscription, saveSubscription, useSender } from "./push.service.js";
import { replyAsStaff } from "./support.service.js";

/**
 * Notices to a driver's phone.
 *
 * What these guard: nothing is sent, and nothing breaks, when the feature is off;
 * a phone is registered only with a valid address and keys, and removed only by
 * its own driver; a dead phone is forgotten; a failure to send never reaches the
 * code that triggered it; and what the notice says never includes what the office wrote.
 */

const norm = (sql) => String(sql).replace(/\s+/g, " ").trim();
const keep = {};
before(() => {
  for (const k of ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"]) keep[k] = process.env[k];
});
after(() => {
  for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});
const on = () => { process.env.VAPID_PUBLIC_KEY = "BPublicKeyForTests_BPublicKeyForTests_BPublicKeyForTests_BPublicKeyForTests_BPublicKeyFor"; process.env.VAPID_PRIVATE_KEY = "PrivateKeyForTests_PrivateKeyForTests"; };
const off = () => { delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY; };

async function withDb(handler, fn) {
  const real = db.execute;
  const calls = [];
  db.execute = async (sql, params) => { calls.push({ sql: norm(sql), params }); return handler(norm(sql), params); };
  try { return await fn(calls); } finally { db.execute = real; }
}

const driver = { driverId: 9, companyId: 7, name: "Juan Dela Cruz" };
const goodSub = (extra = {}) => ({
  endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
  keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" },
  ...extra,
});

test("a subscription is accepted only with an https address and both keys", () => {
  assert.deepEqual(Object.keys(checkSubscription(goodSub())).sort(), ["auth", "endpoint", "p256dh"]);
  for (const bad of [
    null, {}, goodSub({ endpoint: "http://insecure.example/x" }), goodSub({ endpoint: "not a url" }),
    goodSub({ endpoint: `https://x.example/${"a".repeat(2100)}` }), goodSub({ keys: {} }), goodSub({ keys: { p256dh: "short", auth: "short" } }),
    goodSub({ keys: { p256dh: "<script>alert(1)</script>aaaaaaaaaaaa", auth: "tBHItJI5svbpez7KI4CCXg" } }),
  ]) {
    assert.ok(checkSubscription(bad).error, `should refuse ${JSON.stringify(bad)?.slice(0, 60)}`);
  }
});

test("with no keys set the feature is off: nothing is stored, nothing is sent, nothing is asked of the database", async () => {
  off();
  assert.equal(pushEnabled(), false);
  await withDb(() => { throw new Error("nothing should be queried"); }, async () => {
    assert.equal((await saveSubscription({ driver, subscription: goodSub() })).status, 503);
    assert.deepEqual(await notifyDriver({ companyId: 7, driverId: 9, title: "t", body: "b" }), { sent: 0, removed: 0 });
  });
});

test("a phone is registered under the driver and company that asked, once however often it asks", async () => {
  on();
  await withDb(() => [{}], async (calls) => {
    assert.deepEqual(await saveSubscription({ driver, subscription: goodSub(), userAgent: "Chrome Android" }), { ok: true });
    assert.match(calls[0].sql, /INSERT INTO driver_push_subscriptions/);
    assert.match(calls[0].sql, /ON DUPLICATE KEY UPDATE/, "the same phone registering again is one row");
    assert.equal(calls[0].params[0], 7);
    assert.equal(calls[0].params[1], 9);
    assert.match(calls[0].params[3], /^[0-9a-f]{64}$/, "looked up by the hash of its address");
    assert.equal((await saveSubscription({ driver, subscription: { endpoint: "ftp://x" } })).status, 400);
    assert.equal(calls.length, 1, "a bad one stores nothing");
  });
});

test("only the driver's own phone can be turned off", async () => {
  await withDb(() => [{ affectedRows: 1 }], async (calls) => {
    assert.deepEqual(await removeSubscription({ driver, endpoint: goodSub().endpoint }), { ok: true, removed: 1 });
    assert.match(calls[0].sql, /WHERE endpoint_hash = \? AND driver_id = \? AND company_id = \?/);
    assert.deepEqual(calls[0].params.slice(1), [9, 7]);
    assert.equal((await removeSubscription({ driver, endpoint: "" })).status, 400);
  });
});

const subRow = (id) => ({ id, endpoint: `https://push.example/${id}`, p256dh: "p", auth: "a" });

test("every phone the driver registered is told, with a short notice and the right options", async () => {
  on();
  const sent = [];
  const restore = useSender(async (sub, payload, options) => { sent.push({ sub, payload: JSON.parse(payload), options }); });
  try {
    await withDb((q) => (q.startsWith("SELECT") ? [[subRow(1), subRow(2)]] : [{}]), async (calls) => {
      const result = await notifyDriver({ companyId: 7, driverId: 9, title: "The office replied", body: "About SUP-000041.", tag: "support-41" });
      assert.deepEqual(result, { sent: 2, removed: 0 });
      assert.deepEqual(calls[0].params, [7, 9], "only this driver's phones");
    });
    assert.equal(sent.length, 2);
    assert.deepEqual(sent[0].payload, { title: "The office replied", body: "About SUP-000041.", tag: "support-41", url: "/driver" });
    assert.equal(sent[0].options.TTL, 86400);
    assert.ok(sent[0].options.vapidDetails.publicKey);
  } finally { restore(); }
});

test("a phone that is gone is forgotten, and any other failure is left to try again", async () => {
  on();
  const restore = useSender(async (sub) => {
    if (sub.endpoint.endsWith("/1")) throw Object.assign(new Error("gone"), { statusCode: 410 });
    if (sub.endpoint.endsWith("/2")) throw Object.assign(new Error("timeout"), { statusCode: 500 });
  });
  const noisy = console.error;
  console.error = () => {};
  try {
    await withDb((q) => (q.startsWith("SELECT") ? [[subRow(1), subRow(2), subRow(3)]] : [{}]), async (calls) => {
      const result = await notifyDriver({ companyId: 7, driverId: 9, title: "t", body: "b" });
      assert.deepEqual(result, { sent: 1, removed: 1 });
      const deletes = calls.filter((c) => c.sql.startsWith("DELETE"));
      assert.equal(deletes.length, 1);
      assert.deepEqual(deletes[0].params, [1], "only the one the push service said is gone");
    });
  } finally { restore(); console.error = noisy; }
});

test("a database that fails does not stop the reply or the decision that triggered the notice", async () => {
  on();
  const noisy = console.error;
  console.error = () => {};
  try {
    await withDb(() => { throw new Error("db down"); }, async () => {
      assert.deepEqual(await notifyDriver({ companyId: 7, driverId: 9, title: "t", body: "b" }), { sent: 0, removed: 0 });
    });
  } finally { console.error = noisy; }
});

test("when the office replies the driver is notified, and the notice says nothing of what was written", async () => {
  on();
  const sent = [];
  const restore = useSender(async (sub, payload) => { sent.push(JSON.parse(payload)); });
  const handler = (q) => {
    if (q.includes("FROM support_tickets WHERE ticket_id = ?")) return [[{ id: 41, status: "open", driverId: 9, assignedUserId: null }]];
    if (q.startsWith("INSERT INTO support_messages")) return [{ insertId: 88 }];
    if (q.includes("FROM support_messages WHERE message_id")) return [[{ id: 88, ticketId: 41, senderKind: "staff", senderUserId: 2, senderDriverId: null, senderName: "Ana Reyes", body: "Your PIN is 4821, do not share it", clientRef: null, createdAt: "2026-10-14" }]];
    if (q.includes("FROM driver_push_subscriptions")) return [[subRow(1)]];
    return [{}];
  };
  try {
    await withDb(handler, async () => {
      const result = await replyAsStaff({ context: { companyId: 7, branchId: 3 }, user: { userId: 2, name: "Ana Reyes" }, id: 41, input: { body: "Your PIN is 4821, do not share it" } });
      assert.ok(result.message);
      await new Promise((r) => setImmediate(r));
    });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].title, "The office replied");
    assert.match(sent[0].body, /SUP-000041/);
    assert.doesNotMatch(JSON.stringify(sent[0]), /4821|PIN/);
  } finally { restore(); }
});
