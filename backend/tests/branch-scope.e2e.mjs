/**
 * Is a trip in another branch actually hidden?
 *
 * All demo trips live in Davao, so branch scoping cannot be seen just by
 * looking. This moves one trip to Cebu, asks a Davao-scoped user what they can
 * see, then puts it back.
 */
import "../src/config/env.js";
import db from "../src/config/db.js";
import { operatingScope } from "./_context.mjs";

const API = "http://localhost:5000";
let pass = 0, fail = 0;
const check = (n, c, x = "") => { if (c) { pass++; console.log(`ok    ${n}`); } else { fail++; console.log(`FAIL  ${n} ${x}`); } };

const login = async (role) => {
  const r = await fetch(`${API}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `${role}@gmail.com`, password: "demo123" }),
  });
  const j = await r.json();
  const a = await operatingScope(j.data.access, db);
  return { token: j.data.token, companyId: a.company_id, branchId: a.branch_id };
};

const headers = (s, branchId) => ({
  Authorization: `Bearer ${s.token}`,
  "X-Company-Id": String(s.companyId),
  "X-Branch-Id": String(branchId ?? s.branchId),
});

const tripsFor = async (s, branchId) => {
  const r = await fetch(`${API}/api/v1/operations/trips?limit=3000`, { headers: headers(s, branchId) });
  if (!r.ok) return { status: r.status, rows: [] };
  const j = await r.json();
  const rows = Array.isArray(j.data) ? j.data : j.data?.rows || [];
  return { status: r.status, rows };
};

const [[victim]] = await db.execute(
  "SELECT trip_ticket_id id, ticket_no, branch_id FROM trip_tickets WHERE branch_id = 1 ORDER BY trip_ticket_id DESC LIMIT 1"
);
const original = victim.branch_id;

const dispatcher = await login("dispatcher");
const before = await tripsFor(dispatcher);
console.log(`      Davao user sees ${before.rows.length} trips to start\n`);

try {
  await db.execute("UPDATE trip_tickets SET branch_id = 2 WHERE trip_ticket_id = ?", [victim.id]);

  const after = await tripsFor(dispatcher);
  check(
    `${victim.ticket_no} disappears once moved to Cebu`,
    after.rows.length === before.rows.length - 1,
    `${before.rows.length} -> ${after.rows.length}`
  );
  check(
    "and it is not in the list by ticket number",
    !after.rows.some((t) => (t.ticket_no ?? t.ticketNo) === victim.ticket_no)
  );

  // reading it directly, by id, must also be refused
  const direct = await fetch(`${API}/api/v1/operations/trips/${victim.id}`, { headers: headers(dispatcher) });
  check("fetching it directly by id is refused", direct.status === 404 || direct.status === 403, `status=${direct.status}`);

  // and the user cannot simply claim the other branch in the header
  const spoof = await tripsFor(dispatcher, 2);
  check(
    "claiming a branch they have no access to is refused",
    spoof.status === 400 || spoof.status === 403,
    `status=${spoof.status} rows=${spoof.rows.length}`
  );
} finally {
  await db.execute("UPDATE trip_tickets SET branch_id = ? WHERE trip_ticket_id = ?", [original, victim.id]);
  const restored = await tripsFor(dispatcher);
  check("restored", restored.rows.length === before.rows.length, `${restored.rows.length}`);
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  await db.end();
  process.exitCode = fail ? 1 : 0;
}
