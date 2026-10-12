import "../src/config/env.js";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import appDb from "../src/config/db.js";
import { listTrips, tripsSummary } from "../src/modules/operations/trips.controller.js";

/**
 * Paging, filtering and counting the trips list in the database.
 *
 * The list used to be fetched whole and filtered in the browser, which silently
 * stopped at the server's 100-row page. These run the real queries against a
 * real table, because the failures that matter here — a trip shown twice and
 * another never, a footer total that disagrees with the rows, a filter that
 * leaks across a branch — only exist in the SQL.
 *
 * Runs against the development database like the other integration tests (and is
 * refused for a production one). Everything it creates is removed afterwards.
 */

let db;
let ids;
const tag = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const TOTAL = 25;

function response() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}
async function list(branchId, query = {}) {
  const res = response();
  await listTrips({ context: { companyId: ids.A, branchId }, query }, res);
  return res.body;
}
async function summary(branchId) {
  const res = response();
  await tripsSummary({ context: { companyId: ids.A, branchId } }, res);
  return res.body.data;
}

before(async () => {
  try {
    db = await mysql.createConnection({
      host: process.env.DB_HOST || "127.0.0.1",
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD || "",
      database: process.env.DB_NAME || "trackify",
    });
  } catch {
    db = null;
    return;
  }

  const A = (await db.execute("INSERT INTO companies (company_name, company_code, status) VALUES (?, ?, 'active')",
    [`Paging ${tag}`, `PG${tag}`.slice(0, 40)]))[0].insertId;
  const mk = async (code) => (await db.execute(
    "INSERT INTO branches (company_id, branch_name, branch_code, prefix, status) VALUES (?, ?, ?, ?, 'active')", [A, `B ${code}`, code, code]))[0].insertId;
  const A1 = await mk("P1");
  const A2 = await mk("P2");
  const user = (await db.execute(
    "INSERT INTO users (email, password_hash, first_name, last_name, status) VALUES (?, 'not-a-login', 'Page', 'Test', 'active')",
    [`paging-${tag}@example.test`]))[0].insertId;
  const cust = (await db.execute(
    "INSERT INTO customers (company_id, customer_code, customer_name, status) VALUES (?, 'C-PG', ?, 'active')", [A, `Pager ${tag}`]))[0].insertId;

  // TOTAL trips in A1 created in the SAME second — the case that makes an unstable
  // sort show one trip twice and skip another across pages.
  const stamp = "2026-10-01 08:00:00";
  const statuses = ["draft", "approved", "in_transit", "delivered", "draft"];
  const priorities = ["normal", "high", "critical", "low", "normal"];
  for (let i = 0; i < TOTAL; i += 1) {
    await db.execute(
      `INSERT INTO trip_tickets
         (company_id, branch_id, ticket_no, customer_id, purpose, origin, destination, origin_barangay, destination_barangay,
          scheduled_departure, status, priority, created_by, created_at)
       VALUES (?, ?, ?, ?, 'Paging test', 'Origin', 'Dest', ?, 'Poblacion', ?, ?, ?, ?, ?)`,
      [A, A1, `PG-${tag}-${String(i).padStart(3, "0")}`, cust, i % 2 ? "Sasa" : "Matina",
       `2026-10-${String(1 + (i % 9)).padStart(2, "0")} 09:00:00`,
       statuses[i % 5], priorities[i % 5], user, stamp]
    );
  }
  // one trip in the other branch, which must never appear in A1's answers
  await db.execute(
    `INSERT INTO trip_tickets (company_id, branch_id, ticket_no, customer_id, purpose, origin, destination, origin_barangay,
        scheduled_departure, status, created_by)
     VALUES (?, ?, ?, ?, 'Other branch', 'O', 'D', 'OtherPlace', NOW(), 'draft', ?)`,
    [A, A2, `PG-${tag}-OTHER`, cust, user]);

  ids = { A, A1, A2, user };
});

after(async () => {
  await appDb.end().catch(() => {});
  if (!db || !ids) { if (db) await db.end(); return; }
  await db.execute("DELETE FROM trip_tickets WHERE company_id = ?", [ids.A]);
  await db.execute("DELETE FROM customers WHERE company_id = ?", [ids.A]);
  await db.execute("DELETE FROM branches WHERE company_id = ?", [ids.A]);
  await db.execute("DELETE FROM companies WHERE company_id = ?", [ids.A]);
  await db.execute("DELETE FROM users WHERE user_id = ?", [ids.user]);
  await db.end();
});

test("paging through trips created in the same second shows each exactly once", async (t) => {
  if (!db) return t.skip("no database");
  const seen = [];
  for (let page = 1; page <= 3; page += 1) {
    const body = await list(ids.A1, { limit: 10, page });
    assert.equal(body.pagination.total, TOTAL);
    assert.equal(body.pagination.totalPages, 3);
    seen.push(...body.data.map((r) => r.trip_ticket_id));
  }
  assert.equal(seen.length, TOTAL, "every trip appears");
  assert.equal(new Set(seen).size, TOTAL, "no trip appears twice");
});

test("the order is newest first, with the id as the tie-break", async (t) => {
  if (!db) return t.skip("no database");
  const body = await list(ids.A1, { limit: 100 });
  const order = body.data.map((r) => r.trip_ticket_id);
  assert.deepEqual(order, [...order].sort((a, b) => b - a), "same timestamp, so highest id first");
});

test("a page past the end is empty but still reports the real total", async (t) => {
  if (!db) return t.skip("no database");
  const body = await list(ids.A1, { limit: 10, page: 9 });
  assert.deepEqual(body.data, []);
  assert.equal(body.pagination.total, TOTAL);
});

test("a limit above the cap is clamped, and the response says what it used", async (t) => {
  if (!db) return t.skip("no database");
  const body = await list(ids.A1, { limit: 1000 });
  assert.equal(body.pagination.limit, 100);
  assert.equal(body.data.length, TOTAL);
});

test("the total follows the filter, so the footer agrees with the rows", async (t) => {
  if (!db) return t.skip("no database");
  const body = await list(ids.A1, { status: "draft", limit: 5 });
  assert.equal(body.pagination.total, 10); // i % 5 === 0 or 4 → 10 of 25
  assert.equal(body.data.length, 5);
  assert.ok(body.data.every((r) => r.status === "draft"));
  const all = await list(ids.A1, { status: "draft", limit: 100 });
  assert.equal(all.data.length, body.pagination.total);
});

test("several statuses at once", async (t) => {
  if (!db) return t.skip("no database");
  const body = await list(ids.A1, { status: "approved,in_transit", limit: 100 });
  assert.equal(body.pagination.total, 10);
  assert.ok(body.data.every((r) => ["approved", "in_transit"].includes(r.status)));
});

test("priority, barangay and a date range each narrow the list and its total", async (t) => {
  if (!db) return t.skip("no database");
  assert.equal((await list(ids.A1, { priority: "critical" })).pagination.total, 5);
  assert.equal((await list(ids.A1, { barangay: "Sasa" })).pagination.total, 12); // odd i
  assert.equal((await list(ids.A1, { barangay: "Poblacion" })).pagination.total, TOTAL, "destination counts too");
  const day = await list(ids.A1, { from: "2026-10-01", to: "2026-10-01", limit: 100 });
  assert.equal(day.pagination.total, 3); // i = 0, 9, 18
  assert.equal(day.data.length, 3);
});

test("a search narrows the list and the count together", async (t) => {
  if (!db) return t.skip("no database");
  const hit = await list(ids.A1, { search: `Pager ${tag}`, limit: 100 }); // customer name
  assert.equal(hit.pagination.total, TOTAL);
  const one = await list(ids.A1, { search: `PG-${tag}-007` });
  assert.equal(one.pagination.total, 1);
  assert.equal((await list(ids.A1, { search: "no-such-thing-zzz" })).pagination.total, 0);
});

test("filters combine", async (t) => {
  if (!db) return t.skip("no database");
  const body = await list(ids.A1, { status: "draft", priority: "normal", barangay: "Matina", limit: 100 });
  assert.ok(body.data.every((r) => r.status === "draft" && r.priority === "normal" && r.origin_barangay === "Matina"));
  assert.equal(body.data.length, body.pagination.total);
});

test("another branch's trips never appear, in the rows or in the total", async (t) => {
  if (!db) return t.skip("no database");
  const body = await list(ids.A1, { limit: 100 });
  assert.ok(body.data.every((r) => !r.ticket_no.endsWith("-OTHER")));
  assert.equal(body.pagination.total, TOTAL);
  assert.equal((await list(ids.A2)).pagination.total, 1);
});

test("a malformed filter is refused with 400, not answered as 'no trips'", async (t) => {
  if (!db) return t.skip("no database");
  for (const query of [{ status: "flying" }, { priority: "urgent" }, { from: "2026-02-30" }]) {
    await assert.rejects(() => list(ids.A1, query), (e) => e.status === 400, JSON.stringify(query));
  }
});

test("the summary counts every status, zero where there are none, and agrees with the list", async (t) => {
  if (!db) return t.skip("no database");
  const s = await summary(ids.A1);
  assert.equal(s.total, TOTAL);
  assert.equal(s.counts.draft, 10);
  assert.equal(s.counts.approved, 5);
  assert.equal(s.counts.in_transit, 5);
  assert.equal(s.counts.delivered, 5);
  assert.equal(s.counts.cancelled, 0, "a status with no trips is present, as zero");
  assert.equal(Object.values(s.counts).reduce((a, b) => a + b, 0), s.total);
  assert.equal((await list(ids.A1, { status: "in_transit" })).pagination.total, s.counts.in_transit);
});

test("the summary lists the barangays this branch's trips touch, and only this branch's", async (t) => {
  if (!db) return t.skip("no database");
  const s = await summary(ids.A1);
  assert.deepEqual(s.barangays, ["Matina", "Poblacion", "Sasa"]);
  assert.ok(!s.barangays.includes("OtherPlace"));
  assert.deepEqual((await summary(ids.A2)).barangays, ["OtherPlace"]);
});
