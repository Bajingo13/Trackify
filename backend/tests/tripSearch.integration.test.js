import "../src/config/env.js";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import appDb from "../src/config/db.js";
import { searchTrips } from "../src/modules/operations/trips.controller.js";

/**
 * The Ctrl+K trip search against a real database.
 *
 * What it must never do is cross a line it was not given: another company's
 * trips, or another branch's trips of the same company. The search has three
 * ways to match (ticket prefix, then ticket/route/purpose/customer anywhere),
 * and each is checked, because a scope condition missing from one branch of
 * the query is exactly the bug the others would not reveal.
 *
 * Runs against the development database, like the other integration tests, and
 * is refused for a production one (see tests/refuseProductionDatabase.mjs).
 * Everything it creates is removed afterwards.
 */

let db;
let ids;
const tag = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
// one searchable word that appears in every company's and branch's data
const WORD = `Zebra${tag}`;

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}
async function search(companyId, branchId, q, extra = {}) {
  const res = response();
  await searchTrips({ context: { companyId, branchId, userId: 1 }, query: { q, ...extra } }, res);
  assert.equal(res.statusCode, 200);
  return res.body.data.map((r) => r.ticket_no).sort();
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

  const company = async (label) => (await db.execute(
    "INSERT INTO companies (company_name, company_code, status) VALUES (?, ?, 'active')",
    [`Search ${label} ${tag}`, `S${label}${tag}`.slice(0, 40)]
  ))[0].insertId;
  const branch = async (companyId, code) => (await db.execute(
    "INSERT INTO branches (company_id, branch_name, branch_code, prefix, status) VALUES (?, ?, ?, ?, 'active')",
    [companyId, `Branch ${code}`, code, code]
  ))[0].insertId;
  const customer = async (companyId, label) => (await db.execute(
    "INSERT INTO customers (company_id, customer_code, customer_name, status) VALUES (?, ?, ?, 'active')",
    [companyId, `C-${label}`, `${WORD} Customer ${label}`]
  ))[0].insertId;

  const user = (await db.execute(
    "INSERT INTO users (email, password_hash, first_name, last_name, status) VALUES (?, 'not-a-login', 'Search', 'Test', 'active')",
    [`search-${tag}@example.test`]
  ))[0].insertId;

  const A = await company("A");
  const B = await company("B");
  const A1 = await branch(A, "A1");
  const A2 = await branch(A, "A2");
  const B1 = await branch(B, "B1");

  const trip = async (companyId, branchId, ticketNo, customerId, origin = "Davao", purpose = "Delivery") => (await db.execute(
    `INSERT INTO trip_tickets
       (company_id, branch_id, ticket_no, customer_id, purpose, origin, destination, scheduled_departure, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, 'Gensan', NOW(), 'draft', ?)`,
    [companyId, branchId, ticketNo, customerId, purpose, origin, user]
  ))[0].insertId;

  const cA = await customer(A, "A");
  const cB = await customer(B, "B");
  // a customer whose name does not contain the search word, for the wildcard trips
  const cPlain = (await db.execute(
    "INSERT INTO customers (company_id, customer_code, customer_name, status) VALUES (?, 'C-PLAIN', ?, 'active')",
    [A, `Plain ${tag}`]
  ))[0].insertId;
  const t = {
    a1Ticket: await trip(A, A1, `${WORD}-A1`, cA),
    a1Route: await trip(A, A1, `TT-A1-${tag}`, cA, `Origin ${WORD}`),
    a2Ticket: await trip(A, A2, `${WORD}-A2`, cA),
    a2Route: await trip(A, A2, `TT-A2-${tag}`, cA, `Origin ${WORD}`),
    b1Ticket: await trip(B, B1, `${WORD}-B1`, cB),
    b1Route: await trip(B, B1, `TT-B1-${tag}`, cB, `Origin ${WORD}`),
    // a literal wildcard character in a ticket number, and a lookalike without it
    pct: await trip(A, A1, `PCT%${tag}`, cPlain),
    pctLookalike: await trip(A, A1, `PCTX${tag}`, cPlain),
  };
  ids = { A, B, A1, A2, B1, user, ...t };
});

after(async () => {
  await appDb.end().catch(() => {});
  if (!db || !ids) {
    if (db) await db.end();
    return;
  }
  await db.execute("DELETE FROM trip_tickets WHERE company_id IN (?, ?)", [ids.A, ids.B]);
  await db.execute("DELETE FROM customers WHERE company_id IN (?, ?)", [ids.A, ids.B]);
  await db.execute("DELETE FROM branches WHERE company_id IN (?, ?)", [ids.A, ids.B]);
  await db.execute("DELETE FROM companies WHERE company_id IN (?, ?)", [ids.A, ids.B]);
  await db.execute("DELETE FROM users WHERE user_id = ?", [ids.user]);
  await db.end();
});

test("a ticket-number search stays inside the branch it was asked in", async (t) => {
  if (!db) return t.skip("no database");
  assert.deepEqual(await search(ids.A, ids.A1, WORD), [`${WORD}-A1`, `TT-A1-${tag}`].sort());
});

test("the same search in the company's other branch sees only that branch", async (t) => {
  if (!db) return t.skip("no database");
  assert.deepEqual(await search(ids.A, ids.A2, WORD), [`${WORD}-A2`, `TT-A2-${tag}`].sort());
});

test("another company's branch is invisible to a search by customer name, route and ticket alike", async (t) => {
  if (!db) return t.skip("no database");
  // The word is in B1's ticket, route and customer; none of it may reach A.
  for (const branchId of [ids.A1, ids.A2]) {
    const found = await search(ids.A, branchId, WORD);
    assert.ok(found.every((no) => !no.includes("B1")), `leaked into branch ${branchId}: ${found}`);
  }
  assert.deepEqual(await search(ids.B, ids.B1, WORD), [`${WORD}-B1`, `TT-B1-${tag}`].sort());
});

test("a company id paired with another company's branch finds nothing", async (t) => {
  if (!db) return t.skip("no database");
  assert.deepEqual(await search(ids.A, ids.B1, WORD), []);
  assert.deepEqual(await search(ids.B, ids.A1, WORD), []);
});

test("the wider step does not repeat trips the ticket step already found", async (t) => {
  if (!db) return t.skip("no database");
  // A1 has one ticket match and one route match for the word: two rows, not three.
  const found = await search(ids.A, ids.A1, WORD, { limit: 10 });
  assert.equal(new Set(found).size, found.length);
  assert.equal(found.length, 2);
});

test("the limit is honoured across both steps", async (t) => {
  if (!db) return t.skip("no database");
  assert.equal((await search(ids.A, ids.A1, WORD, { limit: 1 })).length, 1);
});

test("a typed % matches a ticket that really contains it, and not its lookalike", async (t) => {
  if (!db) return t.skip("no database");
  const found = await search(ids.A, ids.A1, `PCT%${tag}`);
  assert.deepEqual(found, [`PCT%${tag}`]);
  // a bare wildcard is no longer "match everything"
  assert.deepEqual(await search(ids.A, ids.A1, "%%"), []);
});

test("a one-character term returns nothing and costs nothing", async (t) => {
  if (!db) return t.skip("no database");
  assert.deepEqual(await search(ids.A, ids.A1, "Z"), []);
});

test("SQL metacharacters in the term are only text", async (t) => {
  if (!db) return t.skip("no database");
  assert.deepEqual(await search(ids.A, ids.A1, "x' OR '1'='1"), []);
  assert.deepEqual(await search(ids.A, ids.A1, "'; DROP TABLE trip_tickets; --"), []);
  // and the table is still there
  const [[row]] = await db.execute("SELECT COUNT(*) n FROM trip_tickets WHERE company_id = ?", [ids.A]);
  assert.ok(Number(row.n) >= 1);
});
