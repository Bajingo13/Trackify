/**
 * Hard-deletes a trip ticket and the rows that hang off it.
 *
 * The application deliberately has no delete-trip endpoint: a trip is
 * cancelled, never removed, so the audit trail stays intact. This is the
 * escape hatch for junk rows created while testing — placeholder tickets like
 * "asdasd -> asdada" that were never real work and only clutter the board.
 *
 * It refuses any trip that carries real history: an assignment, an expense,
 * tracking points, or an invoice. Those must be cancelled through the app.
 *
 *   node scripts/purge-trip.mjs TT-2026-000027 TT-2026-000032           # dry run
 *   node scripts/purge-trip.mjs TT-2026-000027 TT-2026-000032 --apply   # deletes
 */
import "../src/config/env.js";
import db from "../src/config/db.js";

const APPLY = process.argv.includes("--apply");
const tickets = process.argv.slice(2).filter((a) => !a.startsWith("--"));

if (!tickets.length) {
  console.error("Usage: node scripts/purge-trip.mjs <TICKET_NO...> [--apply]");
  process.exit(1);
}

/** Anything in here means the trip did real work and must not be hard-deleted. */
const BLOCKING = [
  ["trip_assignments", "an assignment"],
  ["trip_expenses", "an expense"],
  ["trip_tracking_points", "GPS history"],
  ["invoices", "an invoice"],
];

/**
 * Safe to remove alongside the ticket: these are per-trip workflow rows that
 * mean nothing without it. The durable record is audit_logs, which stores the
 * entity id as text with no foreign key, so it survives this deletion.
 */
const CHILDREN = ["trip_status_history", "trip_stops", "approval_actions"];

const count = async (table, id) => {
  try {
    const [[r]] = await db.execute(`SELECT COUNT(*) n FROM ${table} WHERE trip_ticket_id = ?`, [id]);
    return Number(r.n);
  } catch {
    return 0; // table not present in this schema
  }
};

let removed = 0;
let refused = 0;

for (const ticketNo of tickets) {
  const [[trip]] = await db.execute(
    "SELECT trip_ticket_id, ticket_no, status, origin, destination FROM trip_tickets WHERE ticket_no = ? LIMIT 1",
    [ticketNo]
  );

  if (!trip) {
    console.log(`SKIP  ${ticketNo} — no such trip`);
    continue;
  }

  const blockers = [];
  for (const [table, label] of BLOCKING) {
    if (await count(table, trip.trip_ticket_id)) blockers.push(label);
  }

  if (blockers.length) {
    refused += 1;
    console.log(`REFUSE ${ticketNo} — has ${blockers.join(", ")}. Cancel it in the app instead.`);
    continue;
  }

  console.log(
    `${APPLY ? "DELETE" : "WOULD DELETE"} ${ticketNo}  [${trip.status}]  "${trip.origin}" -> "${trip.destination}"`
  );

  if (!APPLY) continue;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    for (const table of CHILDREN) {
      try {
        await conn.execute(`DELETE FROM ${table} WHERE trip_ticket_id = ?`, [trip.trip_ticket_id]);
      } catch { /* table not present */ }
    }
    await conn.execute("DELETE FROM trip_tickets WHERE trip_ticket_id = ?", [trip.trip_ticket_id]);
    await conn.commit();
    removed += 1;
  } catch (err) {
    await conn.rollback().catch(() => {});
    console.error(`  failed: ${err.message}`);
  } finally {
    conn.release();
  }
}

const [[total]] = await db.execute("SELECT COUNT(*) n FROM trip_tickets");
console.log(
  `\n${APPLY ? `${removed} deleted` : "dry run — nothing written"}, ${refused} refused. ${total.n} trips remain.`
);
if (!APPLY) console.log("Re-run with --apply to delete.");

await db.end();
