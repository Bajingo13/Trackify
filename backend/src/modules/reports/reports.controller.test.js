import "../../config/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import db from "../../config/db.js";
import { fleetReport, operationsReport } from "./reports.controller.js";
import { expenseReport, financialReport } from "./reports.finance.controller.js";

/**
 * Reports counted by the database.
 *
 * What these guard is not the SQL — that is the database's job — but the two
 * things a report can get wrong without anyone noticing: a percentage divided
 * by the wrong denominator, and a scope that quietly widens.
 */

/** Answers each query by the first fragment that matches it. */
async function withDb(answers, fn) {
  const real = db.execute;
  const calls = [];
  db.execute = async (sql, params) => {
    calls.push({ sql, params });
    const hit = answers.find(([fragment]) => sql.includes(fragment));
    if (!hit) throw new Error(`Unexpected query: ${sql.slice(0, 80)}`);
    return [hit[1]];
  };
  try {
    return await fn(calls);
  } finally {
    db.execute = real;
  }
}

function recorder() {
  const out = {};
  out.res = {
    status(code) { out.statusCode = code; return this; },
    json(value) { out.body = value; return this; },
  };
  return out;
}

const CONTEXT = { companyId: 7, branchId: 3 };

const FLEET_ANSWERS = [
  ["FROM vehicles v WHERE v.company_id = ? GROUP BY k", [
    { k: "available", c: 2 },
    { k: "on_trip", c: 6 },
    { k: "maintenance", c: 1 },
    { k: "inactive", c: 1 },
  ]],
  ["GROUP BY v.vehicle_type", [{ k: "Closed Van", c: 4 }]],
  ["GROUP BY d.status", [{ k: "on_trip", c: 6 }]],
  ["DATEDIFF(d.license_expiry", [{ expired: 1, soon: 2, valid: 7, total: 10 }]],
  ["GROUP BY m.maintenance_type", [{ k: "Preventive", c: 3 }]],
  ["GROUP BY m.status", [{ k: "completed", c: 2 }]],
  ["COUNT(*) AS jobs", [{ jobs: 3, spend: "12500.00" }]],
  ["GROUP BY v.plate_no", [{ k: "ABC 1234", c: "9000.00" }]],
];

test("availability is measured against the fleet that can actually work", async () => {
  // A retired unit is not an unavailable one. Counting it in the denominator
  // makes a fully-committed fleet look like it has spare capacity it does not.
  const r = recorder();
  await withDb(FLEET_ANSWERS, () => fleetReport({ context: CONTEXT, query: {} }, r.res));

  // 2 available out of 9 working units (10 total, 1 retired) = 22%
  assert.equal(r.body.data.vehicles.availabilityPct, 22);
  assert.equal(r.body.data.vehicles.total, 10);
});

test("vehicle states carry the words the fleet screens already use", async () => {
  const r = recorder();
  await withDb(FLEET_ANSWERS, () => fleetReport({ context: CONTEXT, query: {} }, r.res));

  const labels = r.body.data.vehicles.statusRows.map((x) => x.label);
  assert.deepEqual(labels, ["Available", "On Trip", "Maintenance", "Retired"]);
});

test("a driver with no expiry recorded is a data gap, not an expired licence", async () => {
  const r = recorder();
  await withDb(FLEET_ANSWERS, () => fleetReport({ context: CONTEXT, query: {} }, r.res));

  assert.equal(r.body.data.drivers.atRisk, 3, "expired + expiring soon");
  assert.deepEqual(
    r.body.data.drivers.licenceRows.map((x) => [x.label, x.value]),
    [["Valid", 7], ["Expiring Soon", 2], ["Expired", 1]]
  );
});

test("the fleet report is scoped to the company, as the fleet screens are", async () => {
  const r = recorder();
  const calls = await withDb(FLEET_ANSWERS, async (calls) => {
    await fleetReport({ context: CONTEXT, query: {} }, r.res);
    return calls;
  });

  for (const call of calls) {
    assert.equal(call.params[0], 7, `company must scope: ${call.sql.slice(0, 50)}`);
  }
});

test("a date range reaches the query as parameters, never as text", async () => {
  const r = recorder();
  const calls = await withDb(FLEET_ANSWERS, async (calls) => {
    await fleetReport({ context: CONTEXT, query: { from: "2026-09-01", to: "2026-09-30" } }, r.res);
    return calls;
  });

  const maintenance = calls.find((c) => c.sql.includes("COUNT(*) AS jobs"));
  assert.deepEqual(maintenance.params, [7, "2026-09-01 00:00:00", "2026-09-30 23:59:59"]);
  assert.equal(r.body.data.range.applied, true);
});

test("a malformed date is ignored rather than thrown back at the reader", async () => {
  const r = recorder();
  const calls = await withDb(FLEET_ANSWERS, async (calls) => {
    await fleetReport({ context: CONTEXT, query: { from: "last tuesday" } }, r.res);
    return calls;
  });

  const maintenance = calls.find((c) => c.sql.includes("COUNT(*) AS jobs"));
  assert.deepEqual(maintenance.params, [7], "a bad date must not become a parameter");
  assert.equal(r.body.data.range.applied, false);
});

/* ---- operations ---- */

const OPS_ANSWERS = [
  ["GROUP BY tt.status", [{ k: "delivered", c: 8 }, { k: "in_transit", c: 2 }]],
  ["SUM(CASE WHEN tt.actual_arrival", [{ judged: 4, onTime: 3, avgMinutes: "90.0000", total: 10 }]],
  ["GROUP BY tt.origin, tt.destination", [{ k: "Davao City → Digos City", c: 5 }]],
  ["GROUP BY tt.priority", [{ k: "normal", c: 9 }]],
  ["GROUP BY oe.severity", [{ k: "warning", c: 2 }]],
  ["GROUP BY oe.status", [{ k: "open", c: 1 }, { k: "resolved", c: 1 }]],
  ["GROUP BY oe.exception_type", [{ k: "route_deviation", c: 2 }]],
  ["AVG(TIMESTAMPDIFF(MINUTE, oe.detected_at, oe.resolved_at))", [{ avgMinutes: "150.0000" }]],
];

test("on-time is judged only on trips that recorded an arrival", async () => {
  // Counting a trip with no arrival time as late would measure paperwork
  // rather than lateness.
  const r = recorder();
  await withDb(OPS_ANSWERS, () => operationsReport({ context: CONTEXT, query: {} }, r.res));

  assert.equal(r.body.data.trips.onTimePct, 75, "3 of the 4 judged");
  assert.equal(r.body.data.trips.onTimeJudged, 4);
  assert.equal(r.body.data.trips.total, 10);
});

test("nothing to judge reports no figure rather than nought per cent", async () => {
  const r = recorder();
  await withDb(
    OPS_ANSWERS.map(([f, v]) =>
      f.startsWith("SUM(CASE WHEN tt.actual_arrival")
        ? [f, [{ judged: 0, onTime: 0, avgMinutes: null, total: 3 }]]
        : [f, v]
    ),
    () => operationsReport({ context: CONTEXT, query: {} }, r.res)
  );

  assert.equal(r.body.data.trips.onTimePct, null);
  assert.equal(r.body.data.trips.avgDurationHours, null);
});

test("the operations report is scoped to company and branch, as operations screens are", async () => {
  const r = recorder();
  const calls = await withDb(OPS_ANSWERS, async (calls) => {
    await operationsReport({ context: CONTEXT, query: {} }, r.res);
    return calls;
  });

  for (const call of calls) {
    assert.equal(call.params[0], 7, "company");
    assert.equal(call.params[1], 3, "branch");
  }
});

test("open exceptions are counted separately from the rest", async () => {
  const r = recorder();
  await withDb(OPS_ANSWERS, () => operationsReport({ context: CONTEXT, query: {} }, r.res));

  assert.equal(r.body.data.exceptions.total, 2);
  assert.equal(r.body.data.exceptions.open, 1);
});

/* ---- expenses ---- */

const EXPENSE_ANSWERS = [
  ["COUNT(*) AS count", [{ count: 12, total: "45000.00", unvouchered: "5000.00", reimbursed: "30000.00" }]],
  ["GROUP BY e.category ORDER BY c DESC", [{ k: "fuel", c: "30000.00" }, { k: "toll", c: "15000.00" }]],
  ["DATE_FORMAT(e.expense_date", [{ k: "2026-08", c: "20000.00" }, { k: "2026-09", c: "25000.00" }]],
  ["COALESCE(tt.ticket_no, 'Unassigned')", [{ k: "DVO-2026-0001", c: "9000.00" }, { k: "Unassigned", c: "1200.00" }]],
  ["GROUP BY v.status", [{ k: "paid", c: 3 }, { k: "draft", c: 1 }]],
  ["v.status = 'paid'", [{ paid: "18000.00" }]],
];

test("expense figures come back as numbers, not database strings", async () => {
  // MySQL hands DECIMAL back as a string. Left alone it reaches the chart as
  // text and sorts "9000" above "45000".
  const r = recorder();
  await withDb(EXPENSE_ANSWERS, () => expenseReport({ context: CONTEXT, query: {} }, r.res));

  assert.equal(r.body.data.total, 45000);
  assert.equal(r.body.data.vouchersPaid, 18000);
  assert.equal(typeof r.body.data.categoryRows[0].value, "number");
});

test("an expense with no trip is grouped, never dropped", async () => {
  // It is real money; losing it would make the per-trip chart disagree with
  // the total sitting directly above it.
  const r = recorder();
  await withDb(EXPENSE_ANSWERS, () => expenseReport({ context: CONTEXT, query: {} }, r.res));

  const unassigned = r.body.data.tripRows.find((x) => x.key === "Unassigned");
  assert.ok(unassigned, "expenses with no trip must still appear");
  assert.equal(unassigned.value, 1200);
});

test("months are returned as sortable keys, not as display text", async () => {
  const r = recorder();
  await withDb(EXPENSE_ANSWERS, () => expenseReport({ context: CONTEXT, query: {} }, r.res));

  assert.deepEqual(r.body.data.monthRows.map((x) => x.key), ["2026-08", "2026-09"]);
});

test("the expense report is scoped to the company, as the finance screens are", async () => {
  const r = recorder();
  const calls = await withDb(EXPENSE_ANSWERS, async (calls) => {
    await expenseReport({ context: CONTEXT, query: {} }, r.res);
    return calls;
  });
  for (const call of calls) assert.equal(call.params[0], 7);
});

/* ---- financial ---- */

const FINANCIAL_ANSWERS = [
  ["AS billed", [{ billed: "100000.00", collected: "60000.00", outstanding: "40000.00", overdue: "15000.00" }]],
  ["AS current", [{ current: "25000.00", d30: "10000.00", d60: "5000.00", d90: "0.00" }]],
  ["GROUP BY i.status", [{ k: "paid", c: 4 }, { k: "sent", c: 2 }]],
  ["AS cost", [{ cost: "45000.00" }]],
  ["GROUP BY e.category ORDER BY c DESC", [{ k: "fuel", c: "30000.00" }]],
  ["DATE_FORMAT(i.invoice_date", [{ k: "2026-09", c: "100000.00" }]],
  ["DATE_FORMAT(e.expense_date", [{ k: "2026-09", c: "45000.00" }]],
  ["AS postedValue", [{ draft: 1, posted: 5, postedValue: "88000.00" }]],
];

test("net position is billed work less what it cost to run", async () => {
  const r = recorder();
  await withDb(FINANCIAL_ANSWERS, () => financialReport({ context: CONTEXT }, r.res));

  assert.equal(r.body.data.billed, 100000);
  assert.equal(r.body.data.cost, 45000);
  assert.equal(r.body.data.net, 55000);
});

test("collected counts part-payments, not only settled invoices", async () => {
  // The invoices screen counts an invoice as collected only once it is fully
  // paid. This report has always meant every peso actually received, and the
  // two answers differ the moment a customer pays half.
  const r = recorder();
  await withDb(FINANCIAL_ANSWERS, () => financialReport({ context: CONTEXT }, r.res));

  assert.equal(r.body.data.collected, 60000);
});

test("ageing is reported in four buckets, oldest last", async () => {
  const r = recorder();
  await withDb(FINANCIAL_ANSWERS, () => financialReport({ context: CONTEXT }, r.res));

  assert.deepEqual(
    r.body.data.agingRows.map((x) => [x.label, x.value]),
    [["Current", 25000], ["1–30 days", 10000], ["31–60 days", 5000], ["60+ days", 0]]
  );
});

test("the financial report is scoped to the company", async () => {
  const r = recorder();
  const calls = await withDb(FINANCIAL_ANSWERS, async (calls) => {
    await financialReport({ context: CONTEXT }, r.res);
    return calls;
  });
  for (const call of calls) assert.deepEqual(call.params, [7]);
});
