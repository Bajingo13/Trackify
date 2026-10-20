/**
 * Sample driver messages, so the top bar's "Messages from drivers" list and the
 * bell have something to show while testing.
 *
 * Picks the newest trips that have a driver assigned (one trip per driver,
 * running trips first) and writes a short, unread thread from each driver,
 * spread over the last few hours. Each message carries a "sample-" client_ref,
 * so running this twice adds nothing and --remove takes exactly these away.
 *
 *   node scripts/seed-driver-messages.mjs            # add
 *   node scripts/seed-driver-messages.mjs --remove   # take them away again
 */
import "../src/config/env.js";
import db from "../src/config/db.js";
import { refuseProductionDatabase } from "../src/shared/productionDatabaseGuard.js";

refuseProductionDatabase("seed-driver-messages");

const THREADS = [
  ["Nasa gate na po.", "Sarado pa po ang gate, wala pang guard.", "Ilang minuto pa po ba bago magbukas?"],
  ["Traffic po sa EDSA, mga 30 minutes delay."],
  ["Na-deliver na po. Pinirmahan na ng receiver."],
  ["Kulang po ng isang box sa loading.", "Babalikan ko po ba o ituloy na?"],
  ["Flat tire po, nagpapalit lang.", "Okay na po, tuloy na ulit."],
];

if (process.argv.includes("--remove")) {
  const [res] = await db.execute("DELETE FROM trip_messages WHERE client_ref LIKE 'sample-%'");
  console.log(`removed ${res.affectedRows} sample messages`);
  process.exit(0);
}

const [trips] = await db.execute(
  `SELECT tt.trip_ticket_id AS id, tt.ticket_no AS ticketNo, tt.company_id AS companyId, tt.branch_id AS branchId,
          d.driver_id AS driverId, CONCAT_WS(' ', d.first_name, d.last_name) AS name
     FROM trip_tickets tt
     JOIN trip_assignments ta ON ta.trip_ticket_id = tt.trip_ticket_id AND ta.is_current = TRUE
     JOIN drivers d ON d.driver_id = ta.driver_id
    WHERE tt.status <> 'cancelled'
    ORDER BY (tt.status IN ('in_transit', 'dispatched', 'assigned')) DESC, tt.trip_ticket_id DESC`
);

// one conversation per driver, so every row in the list has a different name
const picked = [];
const seen = new Set();
for (const t of trips) {
  if (seen.has(t.driverId)) continue;
  seen.add(t.driverId);
  picked.push(t);
  if (picked.length === THREADS.length) break;
}
if (!picked.length) { console.error("No trips with an assigned driver to write on."); process.exit(1); }

let added = 0;
for (const [i, t] of picked.entries()) {
  const lines = THREADS[i];
  for (const [j, body] of lines.entries()) {
    // newest conversation first; lines within a thread a minute apart
    const minutesAgo = i * 45 + (lines.length - 1 - j);
    const [res] = await db.execute(
      `INSERT IGNORE INTO trip_messages
         (company_id, branch_id, trip_ticket_id, sender_kind, sender_driver_id, sender_name, body, client_ref, created_at)
       VALUES (?, ?, ?, 'driver', ?, ?, ?, ?, NOW(3) - INTERVAL ? MINUTE)`,
      [t.companyId, t.branchId, t.id, t.driverId, t.name, body, `sample-${t.id}-${j}`, minutesAgo]
    );
    added += res.affectedRows;
  }
  console.log(`${t.ticketNo}  ${t.name}  (${lines.length} message${lines.length > 1 ? "s" : ""})`);
}
console.log(`added ${added} sample messages`);
process.exit(0);
