/**
 * QA helper: measure the trips list queries at scale, with and without the
 * migration 047 indexes, without touching any real trip.
 *
 *   node scripts/qa-trips-scale.mjs [rows]      default 300000 (≈ 1 minute)
 *
 * It copies the shape of trip_tickets into a scratch table
 * (zz_qa_scale_<pid>), fills it with `rows` generated trips, times the queries the
 * Trips screens run, then drops the table — in a `finally`, so it is removed even if
 * a query fails. Refuses to run against a production database.
 *
 * The rows are spread across 3 branches, so the figures are for the branch holding
 * a third of them. Timings are best-of-3, in milliseconds, on this machine: compare
 * the two runs with each other, not with a stopwatch from somewhere else.
 */
import "../src/config/env.js";
import { refuseProductionDatabase } from "../src/shared/productionDatabaseGuard.js";
import db from "../src/config/db.js";

refuseProductionDatabase("a scale measurement on a scratch table");

const ROWS = Number(process.argv[2]) || 300_000;
const T = `zz_qa_scale_${process.pid}`;
const conn = await db.getConnection();
const q = (sql, params) => conn.query(sql, params);

async function best(sql) {
  const runs = [];
  for (let i = 0; i < 3; i += 1) {
    const t = process.hrtime.bigint();
    await q(sql);
    runs.push(Number(process.hrtime.bigint() - t) / 1e6);
  }
  return Math.min(...runs);
}

const queries = () => {
  const page = (extra, offset) =>
    `SELECT trip_ticket_id, ticket_no, status FROM ${T} tt WHERE company_id = 1 AND branch_id = 1 ${extra}
      ORDER BY created_at DESC, trip_ticket_id DESC LIMIT 20 OFFSET ${offset}`;
  const count = (extra) => `SELECT COUNT(*) FROM ${T} tt WHERE company_id = 1 AND branch_id = 1 ${extra}`;
  return [
    ["summary: trips per status (GROUP BY)", `SELECT status, COUNT(*) n FROM ${T} WHERE company_id = 1 AND branch_id = 1 GROUP BY status`],
    ["page 1, no filter", page("", 0)],
    ["page 500 (deep offset), no filter", page("", 10_000)],
    ["page 1, status = in_transit", page("AND status = 'in_transit'", 0)],
    ["count, status = in_transit  (the footer total)", count("AND status = 'in_transit'")],
    ["count, priority = high", count("AND priority = 'high'")],
    ["page 1, date range (last 30 days)", page("AND scheduled_departure >= NOW() - INTERVAL 30 DAY", 0)],
    ["count, no filter", count("")],
  ];
};

async function bench(title) {
  console.log(`\n== ${title} ==`);
  for (const [label, sql] of queries()) {
    console.log(`${label.padEnd(50)} ${(await best(sql)).toFixed(1).padStart(9)} ms`);
  }
}

const NEW_INDEXES = ["idx_tt_scope_status", "idx_tt_scope_priority", "idx_tt_scope_origin_brgy", "idx_tt_scope_dest_brgy"];

try {
  await q(`DROP TABLE IF EXISTS ${T}`);
  await q(`CREATE TABLE ${T} LIKE trip_tickets`);
  await q("SET SESSION cte_max_recursion_depth = 5000000");
  await q(
    `INSERT INTO ${T}
       (company_id, branch_id, ticket_no, purpose, origin, destination, origin_barangay, destination_barangay,
        scheduled_departure, status, priority, created_at, created_by)
     WITH RECURSIVE s(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM s WHERE i < ${ROWS})
     SELECT 1, 1 + (i % 3), CONCAT('TT-', LPAD(i, 8, '0')), 'p', 'o', 'd',
            CONCAT('Brgy ', i % 180), CONCAT('Brgy ', (i * 7) % 180), NOW() - INTERVAL (i % 400) DAY,
            ELT(1 + (i % 100) % 14, 'draft','validated','for_validation','for_approval','approved','rejected','assigned',
                'accepted','released','in_transit','delivered','returned','operationally_closed','cancelled'),
            ELT(1 + i % 4, 'low','normal','high','critical'), NOW() - INTERVAL i MINUTE, 1
       FROM s`
  );
  await q(`ANALYZE TABLE ${T}`);
  const [[c]] = await q(`SELECT COUNT(*) n FROM ${T} WHERE company_id = 1 AND branch_id = 1`);
  console.log(`${ROWS.toLocaleString()} trips generated; ${Number(c.n).toLocaleString()} are in the branch measured below.`);

  await bench("WITH the migration 047 indexes (what you ship)");

  for (const name of NEW_INDEXES) {
    await q(`ALTER TABLE ${T} DROP INDEX ${name}`).catch(() => {});
  }
  await q(`ANALYZE TABLE ${T}`);
  await bench("WITHOUT them (what the database did before 047)");
  console.log("\nRead it as: the second block is the 'before'. Page loads are fast either way; the difference is in the counts.");
} finally {
  await q(`DROP TABLE IF EXISTS ${T}`);
  conn.release();
  await db.end();
}
