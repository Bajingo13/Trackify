import "../../config/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import db from "../../config/db.js";
import tripsRouter from "./trips.routes.js";
import { searchTrips } from "./trips.controller.js";

/**
 * Find-a-trip for the Ctrl+K palette.
 *
 * Two things matter here. Who may ask: a driver, or any role without
 * trip.read, must be refused before a query runs. And what the answer is
 * scoped to: one company and one branch, whatever the person typed. After
 * those, that the search stays cheap — a ticket-number prefix first, the wide
 * scan only for what is left, a deadline on both.
 */

function recorder() {
  const out = { statusCode: 200 };
  out.res = {
    status(code) { out.statusCode = code; return this; },
    json(value) { out.body = value; return this; },
  };
  return out;
}

const req = (query = {}, context = { companyId: 7, branchId: 3, userId: 9 }) => ({ context, query });
const squash = (sql) => String(sql).replace(/\s+/g, " ").trim();

async function withDb(patch, fn) {
  const saved = { execute: db.execute, query: db.query };
  const calls = [];
  db.execute = async (sql, params) => {
    calls.push({ sql: squash(sql), params });
    return patch.execute(String(sql), params, calls.length);
  };
  if (patch.query) db.query = async (sql, params) => patch.query(String(sql), params);
  try {
    return await fn(calls);
  } finally {
    Object.assign(db, saved);
  }
}

const trip = (id, over = {}) => ({
  trip_ticket_id: id, ticket_no: `TT-${String(id).padStart(4, "0")}`, origin: "A", destination: "B", customer_name: "Acme", ...over,
});

/* ---- who may ask ---- */

function searchRoute() {
  const layer = tripsRouter.stack.find((l) => l.route?.path === "/search" && l.route.methods.get);
  assert.ok(layer, "GET /search is registered");
  return { layer, index: tripsRouter.stack.indexOf(layer) };
}

test("/search is registered before /:id, so 'search' is never read as a trip id", () => {
  const { index } = searchRoute();
  const byId = tripsRouter.stack.findIndex((l) => l.route?.path === "/:id" && l.route.methods.get);
  assert.ok(index < byId);
});

test("a user without trip.read is refused before any search runs", async () => {
  const { layer } = searchRoute();
  const guard = layer.route.stack[0].handle;
  let asked = null;
  await withDb(
    { execute: () => { throw new Error("search must not run"); }, query: (sql, params) => { asked = params; return [[]]; } },
    async () => {
      const out = recorder();
      let nextCalled = false;
      await guard({ context: { companyId: 7, branchId: 3, userId: 9 } }, out.res, () => { nextCalled = true; });
      assert.equal(out.statusCode, 403);
      assert.equal(nextCalled, false);
    }
  );
  assert.ok(asked.includes("trip.read"), "the guard asks for trip.read specifically");
});

test("a user holding trip.read is let through to the search", async () => {
  const guard = searchRoute().layer.route.stack[0].handle;
  await withDb({ execute: () => [[]], query: () => [[{ 1: 1 }]] }, async () => {
    let nextCalled = false;
    await guard({ context: { companyId: 7, branchId: 3, userId: 9 } }, recorder().res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
  });
});

/* ---- what the answer is scoped to ---- */

test("every statement is scoped to the caller's company and branch", async () => {
  await withDb({ execute: () => [[]] }, async (calls) => {
    await searchTrips(req({ q: "acme" }), recorder().res);
    assert.equal(calls.length, 2, "nothing found by ticket, so the wider search runs");
    for (const c of calls) {
      assert.match(c.sql, /tt\.company_id = \? AND tt\.branch_id = \?/);
      assert.deepEqual(c.params.slice(0, 2), [7, 3]);
    }
  });
});

test("the company and branch come from the verified context, never the query string", async () => {
  await withDb({ execute: () => [[]] }, async (calls) => {
    await searchTrips(req({ q: "acme", companyId: "99", branchId: "99" }), recorder().res);
    assert.deepEqual(calls[0].params.slice(0, 2), [7, 3]);
  });
});

/* ---- what it asks for ---- */

test("a term under two characters answers empty without touching the database", async () => {
  await withDb({ execute: () => { throw new Error("must not query"); } }, async () => {
    for (const q of ["", " ", "a", " a ", undefined]) {
      const out = recorder();
      await searchTrips(req({ q }), out.res);
      assert.deepEqual(out.body, { success: true, data: [] });
    }
  });
});

test("a ticket-number match fills the list from the index, with no wide scan when it is full", async () => {
  await withDb({ execute: () => [[1, 2, 3, 4, 5].map((i) => trip(i))] }, async (calls) => {
    const out = recorder();
    await searchTrips(req({ q: "TT-00" }), out.res);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].params[2], "TT-00%", "a prefix, which an index can answer");
    assert.match(calls[0].sql, /ORDER BY tt\.ticket_no DESC/);
    assert.equal(out.body.data.length, 5);
  });
});

test("only what is left is searched widely, and never repeats a trip already found", async () => {
  await withDb(
    { execute: (sql, params, n) => (n === 1 ? [[trip(1), trip(2)]] : [[trip(3, { customer_name: "Acme Corp" })]]) },
    async (calls) => {
      const out = recorder();
      await searchTrips(req({ q: "acme" }), out.res);
      assert.equal(calls.length, 2);
      assert.match(calls[1].sql, /NOT IN \(\?, \?\)/);
      assert.deepEqual(calls[1].params.slice(0, 4), [7, 3, 1, 2]);
      assert.match(calls[1].sql, /LIMIT 3$/);
      assert.match(calls[1].sql, /ORDER BY tt\.created_at DESC/);
      assert.deepEqual(out.body.data.map((r) => r.trip_ticket_id), [1, 2, 3]);
    }
  );
});

test("wildcards typed by a person are matched literally in both steps", async () => {
  await withDb({ execute: () => [[]] }, async (calls) => {
    await searchTrips(req({ q: "50%_off" }), recorder().res);
    assert.equal(calls[0].params[2], "50\\%\\_off%");
    assert.equal(calls[1].params.at(-1), "%50\\%\\_off%");
  });
});

test("the limit is clamped, and is never interpolated from raw input", async () => {
  await withDb({ execute: () => [[]] }, async (calls) => {
    await searchTrips(req({ q: "acme", limit: "9999" }), recorder().res);
    assert.match(calls[0].sql, /LIMIT 10$/);
    await searchTrips(req({ q: "acme", limit: "0; DROP TABLE trips" }), recorder().res);
    assert.match(calls.at(-2).sql, /LIMIT 5$/);
    await searchTrips(req({ q: "acme", limit: "-3" }), recorder().res);
    assert.match(calls.at(-2).sql, /LIMIT 1$/);
  });
});

test("every statement carries a deadline so a runaway search is cut off by the database", async () => {
  await withDb({ execute: () => [[]] }, async (calls) => {
    await searchTrips(req({ q: "acme" }), recorder().res);
    for (const c of calls) assert.match(c.sql, /MAX_EXECUTION_TIME\(\d+\)/);
  });
});

test("a search that hits the deadline is reported as 503 with a way forward", async () => {
  await withDb(
    { execute: () => { throw Object.assign(new Error("Query execution was interrupted"), { errno: 3024, code: "ER_QUERY_TIMEOUT" }); } },
    async () => {
      const out = recorder();
      await searchTrips(req({ q: "acme" }), out.res);
      assert.equal(out.statusCode, 503);
      assert.match(out.body.message, /too long/);
    }
  );
});

test("any other database failure still propagates to the error handler", async () => {
  await withDb({ execute: () => { throw Object.assign(new Error("gone"), { code: "ECONNRESET" }); } }, async () => {
    await assert.rejects(() => searchTrips(req({ q: "acme" }), recorder().res), /gone/);
  });
});

test("the response carries only what the palette shows", async () => {
  await withDb({ execute: () => [[{ ...trip(1), purpose: "secret", cargo_weight: 9, driver_name: "X" }]] }, async () => {
    const out = recorder();
    await searchTrips(req({ q: "TT" }), out.res);
    assert.deepEqual(Object.keys(out.body.data[0]).sort(), ["customer_name", "destination", "origin", "ticket_no", "trip_ticket_id"]);
  });
});
