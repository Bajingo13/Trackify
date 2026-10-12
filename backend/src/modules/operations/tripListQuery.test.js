import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseTripListQuery, buildTripWhere, TRIP_STATUSES, TRIP_PRIORITIES,
  DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MAX_PAGE,
} from "./tripListQuery.js";

/**
 * The trips list is filtered and paged by the database. These hold the two
 * things that go wrong quietly: a value from the URL that should be refused but
 * is let through, and a condition whose placeholders and parameters fall out of
 * step (which MySQL reports as an unhelpful error, or worse, binds the wrong
 * value to the wrong column).
 */

const CTX = { companyId: 7, branchId: 3 };
const where = (query) => buildTripWhere(parseTripListQuery(query), CTX);
const placeholders = (sql) => (sql.match(/\?/g) || []).length;

/* ---- parsing ---- */

test("an empty query is page 1 of the default size with no filters", () => {
  const f = parseTripListQuery({});
  assert.deepEqual(f.statuses, []);
  assert.equal(f.priority, "");
  assert.equal(f.search, "");
  assert.equal(f.page, 1);
  assert.equal(f.pageSize, DEFAULT_PAGE_SIZE);
  assert.equal(f.offset, 0);
});

test("'all' means no filter, for status and for priority", () => {
  const f = parseTripListQuery({ status: "all", priority: "all" });
  assert.deepEqual(f.statuses, []);
  assert.equal(f.priority, "");
});

test("the page size is clamped to what the server will return, and the offset follows the page", () => {
  assert.equal(parseTripListQuery({ limit: "5000" }).pageSize, MAX_PAGE_SIZE);
  assert.equal(parseTripListQuery({ limit: "0" }).pageSize, DEFAULT_PAGE_SIZE, "0 is not a size; fall back to the default");
  assert.equal(parseTripListQuery({ limit: "-4" }).pageSize, 1);
  assert.equal(parseTripListQuery({ limit: "abc" }).pageSize, DEFAULT_PAGE_SIZE);
  const f = parseTripListQuery({ page: "3", limit: "25" });
  assert.equal(f.offset, 50);
  assert.equal(parseTripListQuery({ page: "0" }).page, 1);
  assert.equal(parseTripListQuery({ page: "-2" }).page, 1);
  assert.equal(parseTripListQuery({ page: "2.9" }).page, 2);
});

test("a page that is not a finite number is page 1, and an absurd one is held at a ceiling", () => {
  // These made the OFFSET unprintable as SQL ("2e+21", "Infinity") and surfaced as a
  // 500 for a malformed URL. Found by running the API against a real database.
  for (const bad of ["Infinity", "-Infinity", "1e400", "-1e400", "NaN", "abc", "", "  ", null, undefined]) {
    const f = parseTripListQuery({ page: bad });
    assert.equal(f.page, 1, String(bad));
    assert.equal(f.offset, 0, String(bad));
  }
  for (const huge of ["1e20", "9007199254740993", "99999999999999999999", String(MAX_PAGE + 1)]) {
    const f = parseTripListQuery({ page: huge, limit: "100" });
    assert.equal(f.page, MAX_PAGE, huge);
    assert.ok(Number.isSafeInteger(f.offset), `offset for ${huge} must be an integer MySQL can read`);
    assert.match(String(f.offset), /^[0-9]+$/, "no exponent notation");
  }
  assert.equal(parseTripListQuery({ page: String(MAX_PAGE) }).page, MAX_PAGE);
});

test("a limit that is not a finite number never reaches the SQL either", () => {
  for (const bad of ["Infinity", "-Infinity", "1e400", "NaN", "abc"]) {
    const f = parseTripListQuery({ limit: bad });
    assert.ok(Number.isInteger(f.pageSize) && f.pageSize >= 1 && f.pageSize <= MAX_PAGE_SIZE, bad);
  }
});

test("several statuses can be asked for, once each", () => {
  assert.deepEqual(parseTripListQuery({ status: "approved, assigned,approved" }).statuses, ["approved", "assigned"]);
});

test("every real status and priority is accepted", () => {
  for (const s of TRIP_STATUSES) assert.deepEqual(parseTripListQuery({ status: s }).statuses, [s]);
  for (const p of TRIP_PRIORITIES) assert.equal(parseTripListQuery({ priority: p }).priority, p);
});

test("a status that does not exist is refused, not answered with an empty list", () => {
  assert.throws(() => parseTripListQuery({ status: "in_transit,flying" }), (e) => e.status === 400 && /flying/.test(e.message));
});

test("'urgent' is not a priority — the real ones are low, normal, high, critical", () => {
  // The Trips page used to offer an 'Urgent' filter that could never match.
  assert.throws(() => parseTripListQuery({ priority: "urgent" }), (e) => e.status === 400);
});

test("dates must be real calendar dates", () => {
  assert.equal(parseTripListQuery({ from: "2026-10-09" }).from, "2026-10-09");
  for (const bad of ["2026-02-30", "2026-13-01", "10/09/2026", "yesterday", "2026-1-5", "2026-10-09T10:00"]) {
    assert.throws(() => parseTripListQuery({ from: bad }), (e) => e.status === 400, bad);
  }
  assert.throws(() => parseTripListQuery({ from: "2026-10-10", to: "2026-10-09" }), (e) => e.status === 400);
  assert.doesNotThrow(() => parseTripListQuery({ from: "2026-10-09", to: "2026-10-09" }));
});

test("a repeated query parameter (an array) is ignored, not stringified into a filter", () => {
  const f = parseTripListQuery({ search: ["a", "b"], barangay: ["x"], status: ["draft", "approved"] });
  assert.equal(f.search, "");
  assert.equal(f.barangay, "");
  assert.deepEqual(f.statuses, []);
});

/* ---- the condition ---- */

test("every condition is scoped to the caller's company and branch, first", () => {
  const w = where({});
  assert.equal(w.sql, "tt.company_id = ? AND tt.branch_id = ?");
  assert.deepEqual(w.params, [7, 3]);
  assert.equal(w.needsCustomer, false);
  assert.equal(w.needsAssignment, false);
});

test("one status is an equality; several are an IN list, in order", () => {
  assert.match(where({ status: "draft" }).sql, /tt\.status = \?/);
  const many = where({ status: "approved,assigned,released" });
  assert.match(many.sql, /tt\.status IN \(\?, \?, \?\)/);
  assert.deepEqual(many.params.slice(2), ["approved", "assigned", "released"]);
});

test("a date range includes the whole of the 'to' day", () => {
  const w = where({ from: "2026-10-01", to: "2026-10-09" });
  assert.deepEqual(w.params.slice(2), ["2026-10-01 00:00:00", "2026-10-09 23:59:59"]);
});

test("a barangay matches either end or a stop, with the value bound three times", () => {
  const w = where({ barangay: "Sasa" });
  assert.match(w.sql, /origin_barangay = \?/);
  assert.match(w.sql, /destination_barangay = \?/);
  assert.match(w.sql, /EXISTS[\s\S]*stop_barangay = \?/);
  assert.deepEqual(w.params.slice(2), ["Sasa", "Sasa", "Sasa"]);
});

test("a search reads the customer, driver and vehicle, so it needs those joins", () => {
  const w = where({ search: "acme" });
  assert.equal(w.needsCustomer, true);
  assert.equal(w.needsAssignment, true);
  assert.match(w.sql, /c\.customer_name LIKE \?/);
  assert.match(w.sql, /CONCAT\(d\.first_name, ' ', d\.last_name\) LIKE \?/);
  assert.match(w.sql, /v\.plate_no LIKE \?/);
  assert.equal(w.params.filter((p) => p === "%acme%").length, 7);
});

test("a typed wildcard in the search is literal", () => {
  assert.equal(where({ search: "50%" }).params.at(-1), "%50\\%%");
});

test("a filter that does not mention the customer or driver does not ask for their joins", () => {
  for (const q of [{ status: "draft" }, { priority: "high" }, { from: "2026-10-01" }, { barangay: "Sasa" }]) {
    const w = where(q);
    assert.equal(w.needsCustomer || w.needsAssignment, false, JSON.stringify(q));
  }
});

test("nothing from the request is ever written into the SQL text", () => {
  const evil = "x'; DROP TABLE trip_tickets; --";
  const w = where({ search: evil, barangay: evil, status: "draft" });
  assert.ok(!w.sql.includes("DROP"));
  assert.ok(!w.sql.includes(evil));
  assert.ok(w.params.includes(evil), "it travels as a bound value instead");
});

test("placeholders and parameters stay in step across every combination of filters", () => {
  const options = {
    status: [undefined, "draft", "approved,assigned"],
    priority: [undefined, "high"],
    from: [undefined, "2026-10-01"],
    to: [undefined, "2026-10-09"],
    barangay: [undefined, "Sasa"],
    search: [undefined, "acme"],
  };
  const keys = Object.keys(options);
  let checked = 0;
  const walk = (i, query) => {
    if (i === keys.length) {
      const w = where(query);
      assert.equal(placeholders(w.sql), w.params.length, JSON.stringify(query));
      checked += 1;
      return;
    }
    for (const v of options[keys[i]]) walk(i + 1, v === undefined ? query : { ...query, [keys[i]]: v });
  };
  walk(0, {});
  assert.equal(checked, 3 * 2 * 2 * 2 * 2 * 2);
});
