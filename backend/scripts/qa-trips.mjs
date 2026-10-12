/**
 * QA helper: put a known, large set of trips into the DEVELOPMENT database so the
 * Trips list, search, paging, counts, dashboard and export can be tested past the
 * server's 100-row page — and take them out again afterwards.
 *
 *   node scripts/qa-trips.mjs seed [count]     add `count` trips (default 135)
 *   node scripts/qa-trips.mjs status           show what is seeded and the expected numbers
 *   node scripts/qa-trips.mjs clean            remove exactly what `seed` added
 *
 * Optional: --company <id> --branch <id> to choose where (default: the branch that
 * already has the most trips, which is the one the demo account lands in).
 *
 * Safety, in order of importance:
 *   • Refuses to run against a production database (the same guard the test suite
 *     uses) — it writes real rows.
 *   • Everything it adds is marked: ticket numbers "QA-0001…" and purpose
 *     "QA seed". `clean` deletes only rows that carry both marks, in the one branch
 *     they were added to, so it cannot touch real trips.
 *   • `seed` refuses to run twice (clean first), so counts stay predictable.
 *
 * The numbers `status` prints are counted straight from the database with SQL,
 * independently of the API code under test. That is the point: they are the answer
 * key to compare the screen and the API against.
 */
import "../src/config/env.js";
import mysql from "mysql2/promise";
import { refuseProductionDatabase } from "../src/shared/productionDatabaseGuard.js";

refuseProductionDatabase("seeding QA trips");

const [, , command = "status", ...rest] = process.argv;
const flag = (name) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? Number(rest[i + 1]) : null;
};
const count = Number(rest.find((a) => /^\d+$/.test(a))) || 135;

const MARK_PURPOSE = "QA seed";
const MARK_PREFIX = "QA-";

const db = await mysql.createConnection({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "trackify",
});

async function target() {
  const company = flag("company");
  const branch = flag("branch");
  if (company && branch) return { companyId: company, branchId: branch };
  const [[row]] = await db.query(
    `SELECT company_id, branch_id FROM trip_tickets GROUP BY company_id, branch_id ORDER BY COUNT(*) DESC LIMIT 1`
  );
  if (!row) throw new Error("No trips exist to infer a branch from; pass --company and --branch.");
  return { companyId: row.company_id, branchId: row.branch_id };
}

const where = (t) => ({
  sql: "company_id = ? AND branch_id = ? AND purpose = ? AND ticket_no LIKE ?",
  params: [t.companyId, t.branchId, MARK_PURPOSE, `${MARK_PREFIX}%`],
});

async function seeded(t) {
  const w = where(t);
  const [[r]] = await db.query(`SELECT COUNT(*) n FROM trip_tickets WHERE ${w.sql}`, w.params);
  return Number(r.n);
}

const pad = (n, w = 2) => String(n).padStart(w, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

async function seed(t) {
  if (await seeded(t)) throw new Error("QA trips are already seeded here. Run `clean` first so the expected numbers stay predictable.");

  const [[user]] = await db.query("SELECT user_id FROM users WHERE status = 'active' ORDER BY user_id LIMIT 1");
  const [[cust]] = await db.query("SELECT customer_id FROM customers WHERE company_id = ? ORDER BY customer_id LIMIT 1", [t.companyId]);
  if (!user) throw new Error("No active user to attribute the trips to.");

  // Spread, on purpose, so every filter has something to find and something to exclude.
  const statuses = ["draft", "for_approval", "approved", "assigned", "in_transit", "delivered", "operationally_closed", "cancelled"];
  const priorities = ["normal", "normal", "high", "low", "critical"];
  const barangays = ["Sasa", "Matina", "Buhangin", "Toril", "Poblacion"];
  const customers = ["Acme", "Santos", "Mindanao", "Davao"];
  const now = new Date();
  const rows = [];
  for (let i = 1; i <= count; i += 1) {
    // Every 10 trips share ONE created_at second. An unstable sort would show one
    // of them twice and skip another across pages — this is what exposes it.
    const batch = Math.floor((i - 1) / 10);
    const created = new Date(now.getTime() - batch * 3600_000);
    const createdAt = `${ymd(created)} ${pad(created.getHours())}:${pad(created.getMinutes())}:00`;
    // 1 in 9 leaves today; the rest are spread over the previous 30 days.
    const depart = new Date(now.getTime() - (i % 9 === 0 ? 0 : (i % 30) + 1) * 86400_000);
    rows.push([
      t.companyId, t.branchId, `${MARK_PREFIX}${pad(i, 4)}`, cust?.customer_id ?? null, MARK_PURPOSE,
      `${customers[i % customers.length]} depot ${i}`, `Warehouse ${i % 7}`,
      barangays[i % barangays.length], barangays[(i + 2) % barangays.length],
      `${ymd(depart)} 09:00:00`, statuses[i % statuses.length], priorities[i % priorities.length],
      user.user_id, createdAt,
    ]);
  }
  await db.query(
    `INSERT INTO trip_tickets
       (company_id, branch_id, ticket_no, customer_id, purpose, origin, destination,
        origin_barangay, destination_barangay, scheduled_departure, status, priority, created_by, created_at)
     VALUES ?`,
    [rows]
  );
  console.log(`Seeded ${rows.length} trips (QA-0001 … QA-${pad(rows.length, 4)}) into company ${t.companyId}, branch ${t.branchId}.`);
}

async function status(t) {
  const n = await seeded(t);
  const [[all]] = await db.query("SELECT COUNT(*) n FROM trip_tickets WHERE company_id = ? AND branch_id = ?", [t.companyId, t.branchId]);
  console.log(`Branch: company ${t.companyId}, branch ${t.branchId}`);
  console.log(`Trips in this branch: ${all.n}  (of which QA-seeded: ${n})`);
  if (!n) { console.log("Nothing seeded. Run: node scripts/qa-trips.mjs seed"); return; }

  const q = async (sql, params = []) => (await db.query(sql, [t.companyId, t.branchId, ...params]))[0];
  const scope = "company_id = ? AND branch_id = ?";
  console.log("\n== ANSWER KEY (counted by SQL, for the WHOLE branch — compare the UI/API to these) ==");
  console.log("\nPer status:");
  console.table(Object.fromEntries((await q(`SELECT status, COUNT(*) n FROM trip_tickets WHERE ${scope} GROUP BY status ORDER BY status`)).map((r) => [r.status, Number(r.n)])));
  console.log("Per priority:");
  console.table(Object.fromEntries((await q(`SELECT priority, COUNT(*) n FROM trip_tickets WHERE ${scope} GROUP BY priority`)).map((r) => [r.priority, Number(r.n)])));
  const today = ymd(new Date());
  const [[td]] = await db.query(`SELECT COUNT(*) n FROM trip_tickets WHERE ${scope} AND scheduled_departure >= ? AND scheduled_departure <= ?`, [t.companyId, t.branchId, `${today} 00:00:00`, `${today} 23:59:59`]);
  console.log(`Leaving today (${today}):            ${td.n}`);
  const [[sasa]] = await db.query(`SELECT COUNT(*) n FROM trip_tickets WHERE ${scope} AND (origin_barangay = 'Sasa' OR destination_barangay = 'Sasa')`, [t.companyId, t.branchId]);
  console.log(`Barangay "Sasa" (either end):       ${sasa.n}`);
  const [[pend]] = await db.query(`SELECT COUNT(*) n FROM trip_tickets WHERE ${scope} AND status IN ('for_validation','for_approval')`, [t.companyId, t.branchId]);
  console.log(`Awaiting validation/approval:       ${pend.n}   (dashboard "Approval queue")`);
  const [[acme]] = await db.query(`SELECT COUNT(*) n FROM trip_tickets WHERE ${scope} AND (ticket_no LIKE '%Acme%' OR origin LIKE '%Acme%' OR destination LIKE '%Acme%' OR purpose LIKE '%Acme%')`, [t.companyId, t.branchId]);
  console.log(`Search "Acme" (ticket/route/purpose): ${acme.n}  (customer-name matches are extra)`);
  console.log(`\nPages at 20 per page: ${Math.ceil(all.n / 20)}   at 100 per request: ${Math.ceil(all.n / 100)}`);
}

/**
 * Remove the QA trips, and whatever testing them created.
 *
 * Trying out a seeded trip in the app (submitting it, assigning a driver,
 * chatting on it) writes rows that point at it — approval actions, status history,
 * messages. Those reference the trip, so the trip cannot be deleted while they
 * exist. They are found from the schema (every foreign key to trip_tickets), so
 * this stays right as tables are added, and only rows pointing at QA trips are
 * touched. All in one transaction: either everything goes or nothing does.
 */
async function clean(t) {
  const w = where(t);
  const [trips] = await db.query(`SELECT trip_ticket_id FROM trip_tickets WHERE ${w.sql}`, w.params);
  if (!trips.length) { console.log("No QA trips to remove."); return; }
  const ids = trips.map((r) => r.trip_ticket_id);

  const [children] = await db.query(
    `SELECT table_name AS tbl, column_name AS col FROM information_schema.key_column_usage
      WHERE table_schema = DATABASE() AND referenced_table_name = 'trip_tickets' AND referenced_column_name = 'trip_ticket_id'`
  );

  await db.beginTransaction();
  try {
    for (const { tbl, col } of children) {
      const [r] = await db.query(`DELETE FROM \`${tbl}\` WHERE \`${col}\` IN (?)`, [ids]);
      if (r.affectedRows) console.log(`  removed ${r.affectedRows} row(s) from ${tbl} that pointed at QA trips`);
    }
    const [r] = await db.query(`DELETE FROM trip_tickets WHERE trip_ticket_id IN (?)`, [ids]);
    await db.commit();
    console.log(`Removed ${r.affectedRows} QA trips from company ${t.companyId}, branch ${t.branchId}.`);
  } catch (error) {
    await db.rollback();
    throw error;
  }
}

try {
  const t = await target();
  if (command === "seed") { await seed(t); await status(t); }
  else if (command === "status") await status(t);
  else if (command === "clean") await clean(t);
  else throw new Error(`Unknown command "${command}". Use seed | status | clean.`);
} catch (error) {
  console.error(`qa-trips: ${error.message}`);
  process.exitCode = 1;
} finally {
  await db.end();
}
