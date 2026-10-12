/**
 * QA runner: check the Trips API against the database, past the 100-row page.
 *
 *   node scripts/qa-trips-verify.mjs [--branch <id>] [--keep-fixtures]
 *
 * Needs the API running (TRACKIFY_API_URL, default http://localhost:5000) and the
 * QA trips seeded (`node scripts/qa-trips.mjs seed 135 --branch <id>`).
 *
 * How it decides pass or fail: every expected number is counted by RAW SQL in this
 * file, written independently of the code under test (no shared query builder), and
 * compared with what the API answers. If both are wrong in the same way it would
 * not notice, which is why the SQL here is written out plainly and by hand.
 *
 * It first adds a few harder rows (all marked QA, so `qa-trips.mjs clean` removes
 * them): trips with a driver and vehicle assigned, trips whose only link to a
 * barangay is a stop, text with quotes/commas/unicode, and trips either side of
 * midnight. Refuses a production database.
 */
import "../src/config/env.js";
import mysql from "mysql2/promise";
import { refuseProductionDatabase } from "../src/shared/productionDatabaseGuard.js";

refuseProductionDatabase("verifying the trips API with QA fixtures");

const API = (process.env.TRACKIFY_API_URL || "http://localhost:5000").replace(/\/$/, "");
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : null; };
const KEEP = process.argv.includes("--keep-fixtures");

const db = await mysql.createConnection({
  host: process.env.DB_HOST || "127.0.0.1", port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD || "", database: process.env.DB_NAME || "trackify",
});

/* ---------------------------------------------------------------- sign in */
const login = await (await fetch(`${API}/api/auth/login`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: process.env.TRACKIFY_TEST_EMAIL || "superadmin@gmail.com", password: process.env.TRACKIFY_TEST_PASSWORD || "demo123" }),
})).json();
const user = login.data;
const wanted = arg("branch");
const scope = user.access.find((a) => (wanted ? String(a.branch_id) === wanted : a.branch_id)) || user.access[0];
const C = scope.company_id, B = scope.branch_id;
const H = { Authorization: `Bearer ${user.token}`, "X-Company-Id": String(C), "X-Branch-Id": String(B) };
const call = async (path, headers = H) => {
  const r = await fetch(`${API}/api/v1${path}`, { headers });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const sql = async (q, p = []) => (await db.query(q, p))[0];
const n = async (q, p = []) => Number((await sql(q, p))[0].n);

let pass = 0, fail = 0;
const results = [];
const check = (group, name, ok, detail = "") => {
  ok ? pass++ : fail++;
  results.push({ group, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  [${group}] ${name}${detail ? "  — " + detail : ""}`);
};
const SCOPE = "tt.company_id = ? AND tt.branch_id = ?";
const sp = (...extra) => [C, B, ...extra];

/* ---------------------------------------------------------------- fixtures */
const FIXTURE_PREFIX = "QA-X";
async function addFixtures() {
  if (await n("SELECT COUNT(*) n FROM trip_tickets WHERE company_id=? AND branch_id=? AND ticket_no LIKE 'QA-X%'", [C, B])) return false;
  const [[u]] = await db.query("SELECT user_id FROM users WHERE status='active' ORDER BY user_id LIMIT 1");
  const [[cust]] = await db.query("SELECT customer_id FROM customers WHERE company_id=? ORDER BY customer_id LIMIT 1", [C]);
  const drivers = await sql("SELECT driver_id, first_name, last_name FROM drivers WHERE company_id=? ORDER BY driver_id LIMIT 2", [C]);
  const vehicles = await sql("SELECT vehicle_id, plate_no FROM vehicles WHERE company_id=? ORDER BY vehicle_id LIMIT 2", [C]);
  const now = new Date(); const p2 = (x) => String(x).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  const tomorrow = new Date(now.getTime() + 86400_000);

  const insert = async (ticket, over = {}) => {
    const r = { origin: "QA origin", destination: "QA destination", origin_barangay: "Toril", destination_barangay: "Poblacion",
      scheduled_departure: `${ymd(now)} 09:00:00`, status: "draft", ...over };
    const [res] = await db.query(
      `INSERT INTO trip_tickets (company_id, branch_id, ticket_no, customer_id, purpose, origin, destination, origin_barangay,
         destination_barangay, scheduled_departure, status, priority, created_by)
       VALUES (?, ?, ?, ?, 'QA seed', ?, ?, ?, ?, ?, ?, 'normal', ?)`,
      [C, B, ticket, cust?.customer_id ?? null, r.origin, r.destination, r.origin_barangay, r.destination_barangay, r.scheduled_departure, r.status, u.user_id]);
    return res.insertId;
  };
  const assign = (tripId, d, v, current = true) => db.query(
    "INSERT INTO trip_assignments (company_id, branch_id, trip_ticket_id, driver_id, vehicle_id, assigned_by, is_current) VALUES (?,?,?,?,?,?,?)",
    [C, B, tripId, d.driver_id, v.vehicle_id, u.user_id, current]);

  // driver + vehicle assigned: 3 trips to driver 1 / vehicle 1, 2 to driver 2 / vehicle 2
  for (let i = 1; i <= 3; i += 1) await assign(await insert(`${FIXTURE_PREFIX}D${i}`, { status: "assigned" }), drivers[0], vehicles[0]);
  for (let i = 4; i <= 5; i += 1) await assign(await insert(`${FIXTURE_PREFIX}D${i}`, { status: "assigned" }), drivers[1], vehicles[1]);
  // a trip whose driver was changed: one old (not current) and one current assignment
  const reassigned = await insert(`${FIXTURE_PREFIX}D6`, { status: "assigned" });
  await assign(reassigned, drivers[1], vehicles[1], false);
  await assign(reassigned, drivers[0], vehicles[0], true);
  // stop-only barangay: 4 trips whose ONLY link to "QAStopOnly" is a stop
  for (let i = 1; i <= 4; i += 1) {
    const id = await insert(`${FIXTURE_PREFIX}S${i}`);
    await db.query("INSERT INTO trip_stops (trip_ticket_id, location_name, stop_order, stop_barangay) VALUES (?, ?, 1, 'QAStopOnly')", [id, `Stop ${i}`]);
  }
  // text that breaks naive code: quotes, commas, newline, markup, unicode, emoji
  await insert(`${FIXTURE_PREFIX}T1`, { origin: `O'Brien, "Quoted" & <b>bold</b>`, destination: "Plain" });
  await insert(`${FIXTURE_PREFIX}T2`, { origin: "Café – Dávao 🚚", destination: "Line one\nLine two" });
  await insert(`${FIXTURE_PREFIX}T3`, { origin: "100% real_deal", destination: "back\\slash" });
  // either side of midnight
  await insert(`${FIXTURE_PREFIX}M1`, { scheduled_departure: `${ymd(now)} 23:59:59` });
  await insert(`${FIXTURE_PREFIX}M2`, { scheduled_departure: `${ymd(tomorrow)} 00:00:00` });
  await insert(`${FIXTURE_PREFIX}M3`, { scheduled_departure: `${ymd(now)} 00:00:00` });
  return true;
}

/* ------------------------------------------------------------------ checks */
const added = await addFixtures();
const total = await n(`SELECT COUNT(*) n FROM trip_tickets tt WHERE ${SCOPE}`, sp());
const qaCount = await n(`SELECT COUNT(*) n FROM trip_tickets tt WHERE ${SCOPE} AND tt.purpose='QA seed'`, sp());
console.log(`\nBranch ${C}/${B}: ${total} trips in SQL (${qaCount} QA)${added ? ", fixtures added" : ", fixtures already present"}.`);
if (total <= 130) console.log(`WARNING: only ${total} trips; seed more (qa-trips.mjs seed 135) to test beyond the 100-row page.`);

const list = (q) => call(`/operations/trips?${q}`);
const ids = (r) => r.body.data.map((t) => t.trip_ticket_id);

// A. totals and summary
{
  const g = "A totals";
  const s = (await call("/operations/trips/summary")).body.data;
  check(g, `summary.total equals SQL (${total} — more than the old 100)`, s.total === total, `${s.total} vs ${total}`);
  const byStatus = await sql(`SELECT status, COUNT(*) n FROM trip_tickets tt WHERE ${SCOPE} GROUP BY status`, sp());
  check(g, "every status count equals SQL", byStatus.every((r) => s.counts[r.status] === Number(r.n)));
  check(g, "counts add up to the total", Object.values(s.counts).reduce((a, b) => a + b, 0) === s.total);
  check(g, "statuses with no trips are present as 0", Object.values(s.counts).every((v) => Number.isInteger(v)) && Object.keys(s.counts).length === 14);
  const old = await list("limit=5000");
  check(g, "the old ceiling is visible: a request for 5000 returns 100 rows but reports the true total",
    old.body.data.length === 100 && old.body.pagination.limit === 100 && old.body.pagination.total === total, `${old.body.data.length} rows, total ${old.body.pagination.total}`);
}

// B. pagination
{
  const g = "B paging";
  const pages = Math.ceil(total / 20); const seen = [];
  for (let p = 1; p <= pages; p += 1) seen.push(...ids(await list(`page=${p}&limit=20`)));
  const orderSql = (await sql(`SELECT trip_ticket_id id FROM trip_tickets tt WHERE ${SCOPE} ORDER BY created_at DESC, trip_ticket_id DESC`, sp())).map((r) => r.id);
  check(g, `walking all ${pages} pages returns every trip exactly once`, seen.length === total && new Set(seen).size === total, `${seen.length} rows, ${new Set(seen).size} unique`);
  check(g, "…in newest-first order, ties broken by id (equals SQL's own ORDER BY)", JSON.stringify(seen) === JSON.stringify(orderSql));
  const chunk = [];
  for (let p = 1; p <= Math.ceil(total / 100); p += 1) chunk.push(...ids(await list(`page=${p}&limit=100`)));
  check(g, `100-per-request paging (${Math.ceil(total / 100)} requests) gives the identical sequence`, JSON.stringify(chunk) === JSON.stringify(orderSql));
  const again = []; for (let p = 1; p <= pages; p += 1) again.push(...ids(await list(`page=${p}&limit=20`)));
  check(g, "walking twice gives the same order (stable)", JSON.stringify(again) === JSON.stringify(seen));
  const last = await list(`page=${pages}&limit=20`);
  check(g, "the last page holds the remainder", last.body.data.length === total - (pages - 1) * 20, `${last.body.data.length}`);
  const past = await list(`page=${pages + 50}&limit=20`);
  check(g, "a page past the end is empty, with the true total", past.body.data.length === 0 && past.body.pagination.total === total);
  const tied = await sql(`SELECT created_at, COUNT(*) c FROM trip_tickets tt WHERE ${SCOPE} GROUP BY created_at HAVING c > 5 LIMIT 1`, sp());
  check(g, "the data really contains trips sharing one created_at second (the tie-break is being exercised)", tied.length > 0, tied[0] ? `${tied[0].c} trips share ${tied[0].created_at.toISOString?.() ?? tied[0].created_at}` : "none — seed more");
}

// C. filters
{
  const g = "C filters";
  const eq = async (name, q, cond, params = []) => {
    const r = await list(q); const expected = await n(`SELECT COUNT(*) n FROM trip_tickets tt WHERE ${SCOPE} AND ${cond}`, sp(...params));
    check(g, name, r.status === 200 && r.body.pagination.total === expected, `API ${r.body.pagination?.total} vs SQL ${expected}`);
  };
  await eq("status=in_transit", "status=in_transit", "tt.status='in_transit'");
  await eq("status list approved,assigned,released", "status=approved,assigned,released", "tt.status IN ('approved','assigned','released')");
  await eq("priority=critical", "priority=critical", "tt.priority='critical'");
  await eq("priority=low", "priority=low", "tt.priority='low'");
  await eq("barangay=Sasa matches origin or destination", "barangay=Sasa", "(tt.origin_barangay='Sasa' OR tt.destination_barangay='Sasa')");
  await eq("barangay=QAStopOnly matches a STOP only (4 fixture trips)", "barangay=QAStopOnly",
    "(tt.origin_barangay='QAStopOnly' OR tt.destination_barangay='QAStopOnly' OR EXISTS (SELECT 1 FROM trip_stops ts WHERE ts.trip_ticket_id=tt.trip_ticket_id AND ts.stop_barangay='QAStopOnly'))");
  const stopOnly = await list("barangay=QAStopOnly");
  check(g, "…and that is exactly 4, each listed once", stopOnly.body.pagination.total === 4 && new Set(ids(stopOnly)).size === 4);
  const d = new Date(); const p2 = (x) => String(x).padStart(2, "0"); const today = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  await eq("from=to=today includes the whole day (00:00:00 … 23:59:59)", `from=${today}&to=${today}`, "tt.scheduled_departure BETWEEN ? AND ?", [`${today} 00:00:00`, `${today} 23:59:59`]);
  const day = await list(`from=${today}&to=${today}&limit=100`);
  const tickets = day.body.data.map((t) => t.ticket_no);
  check(g, "a trip at 23:59:59 today is IN, one at 00:00:00 tomorrow is OUT", tickets.includes("QA-XM1") && !tickets.includes("QA-XM2") && tickets.includes("QA-XM3"));
  await eq("three filters together", "status=in_transit&priority=high&barangay=Sasa", "tt.status='in_transit' AND tt.priority='high' AND (tt.origin_barangay='Sasa' OR tt.destination_barangay='Sasa')");
  const many = await list("status=draft&priority=normal&limit=100");
  check(g, "every row returned satisfies the filters", many.body.data.every((t) => t.status === "draft" && t.priority === "normal"));
}

// D. search (through the customer, driver and vehicle joins)
{
  const g = "D search";
  const like = (t) => `%${t.replace(/[\\%_]/g, "\\$&")}%`;
  const oracle = async (term) => n(
    `SELECT COUNT(DISTINCT tt.trip_ticket_id) n
       FROM trip_tickets tt
       LEFT JOIN customers c ON c.customer_id = tt.customer_id
       LEFT JOIN trip_assignments ta ON ta.trip_ticket_id = tt.trip_ticket_id AND ta.is_current = TRUE
       LEFT JOIN drivers d ON d.driver_id = ta.driver_id
       LEFT JOIN vehicles v ON v.vehicle_id = ta.vehicle_id
      WHERE ${SCOPE} AND (tt.ticket_no LIKE ? OR tt.origin LIKE ? OR tt.destination LIKE ? OR tt.purpose LIKE ?
            OR c.customer_name LIKE ? OR CONCAT(d.first_name,' ',d.last_name) LIKE ? OR v.plate_no LIKE ?)`,
    sp(...Array(7).fill(like(term))));
  const term = async (label, t) => {
    const r = await list(`search=${encodeURIComponent(t)}&limit=100`); const expected = await oracle(t);
    check(g, label, r.status === 200 && r.body.pagination.total === expected && r.body.data.length === Math.min(expected, 100), `API ${r.body.pagination?.total} (${r.body.data?.length} rows) vs SQL ${expected}`);
    return r;
  };
  await term("by ticket number (QA-0042)", "QA-0042");
  await term("by a word in the route (depot)", "depot");
  const drv = (await sql("SELECT first_name f FROM drivers WHERE company_id=? ORDER BY driver_id LIMIT 1", [C]))[0].f;
  const byDriver = await term(`by DRIVER name (${drv}) — through the driver join`, drv);
  check(g, "…a driver search finds the assigned fixture trips", byDriver.body.data.some((t) => t.ticket_no.startsWith("QA-XD")));
  const plate = (await sql("SELECT plate_no p FROM vehicles WHERE company_id=? ORDER BY vehicle_id LIMIT 1", [C]))[0].p;
  await term(`by vehicle plate (${plate})`, plate);
  const re = await list(`search=QA-XD6&limit=100`);
  check(g, "a trip that was re-assigned appears once, not once per assignment", re.body.pagination.total === 1 && re.body.data.length === 1);
  await term("with an apostrophe (O'Brien)", "O'Brien");
  await term("with double quotes", `"Quoted"`);
  await term("with markup (<b>)", "<b>bold</b>");
  await term("with unicode (Café)", "Café");
  await term("with an emoji", "🚚");
  await term("with a newline in the data (Line two)", "Line two");
  await term("a literal percent sign (100%)", "100%");
  await term("a literal underscore (real_deal)", "real_deal");
  await term("a literal backslash (back\\slash)", "back\\slash");
  const pct = await list("search=%25&limit=100");
  check(g, "a bare % does not match everything", pct.body.pagination.total < total, `${pct.body.pagination.total} of ${total}`);
  await term("no match at all", "zzz-nothing-zzz");
  const long = await list(`search=${"x".repeat(400)}`);
  check(g, "a 400-character term is accepted (capped), not an error", long.status === 200);
  const blank = await list("search=%20%20%20");
  check(g, "a whitespace-only search means no search", blank.body.pagination.total === total);
  const sub = await list(`search=${encodeURIComponent("x'; DROP TABLE trip_tickets; --")}`);
  check(g, "SQL metacharacters are only text, and the table survives", sub.status === 200 && (await n("SELECT COUNT(*) n FROM trip_tickets")) >= total);
}

// E. parameter edge cases — none of these may produce a 500
{
  const g = "E params";
  const ok200 = async (name, q, extra = () => true) => { const r = await list(q); check(g, name, r.status === 200 && extra(r), `status ${r.status}`); return r; };
  await ok200("page=0 → page 1", "page=0", (r) => r.body.pagination.page === 1);
  await ok200("page=-5 → page 1", "page=-5", (r) => r.body.pagination.page === 1);
  await ok200("page=abc → page 1", "page=abc", (r) => r.body.pagination.page === 1);
  await ok200("page=2.9 → page 2", "page=2.9&limit=20", (r) => r.body.pagination.page === 2);
  await ok200("page=Infinity does not crash the query", "page=Infinity");
  await ok200("page=1e400 (parses to Infinity) does not crash", "page=1e400");
  await ok200("page=1e20 (offset would print as 2e+21) does not crash", "page=1e20");
  await ok200("page=9007199254740993 (beyond safe integers) does not crash", "page=9007199254740993");
  await ok200("page=99999999 (a huge but real page) is empty with the true total", "page=99999999", (r) => r.body.data.length === 0 && r.body.pagination.total === total);
  await ok200("limit=abc → default 20", "limit=abc", (r) => r.body.pagination.limit === 20);
  await ok200("limit=0 → default 20", "limit=0", (r) => r.body.pagination.limit === 20);
  await ok200("limit=-3 → 1", "limit=-3", (r) => r.body.pagination.limit === 1);
  await ok200("limit=20.7 → 20", "limit=20.7", (r) => r.body.pagination.limit === 20);
  await ok200("limit=1e400 → capped to 100", "limit=1e400", (r) => r.body.pagination.limit === 100);
  await ok200("a repeated parameter is ignored", "status=draft&status=approved", (r) => r.body.pagination.total === total);
  await ok200("unknown parameters are ignored", "nonsense=1&limit=5", (r) => r.body.data.length === 5);
}

// F. validation and scope
{
  const g = "F safety";
  for (const q of ["status=flying", "status=in_transit,flying", "priority=urgent", "from=2026-02-30", "from=2026-13-01", "from=10/09/2026", "from=yesterday", "to=2026-1-5", "from=2026-10-10&to=2026-10-09"]) {
    const r = await list(q); check(g, `"${q}" is refused with 400`, r.status === 400, `got ${r.status}: ${r.body.message || ""}`);
  }
  check(g, "no sign-in → 401", (await fetch(`${API}/api/v1/operations/trips?limit=1`)).status === 401);
  check(g, "summary without sign-in → 401", (await fetch(`${API}/api/v1/operations/trips/summary`)).status === 401);
  check(g, "a branch that does not exist is refused", [400, 403].includes((await call("/operations/trips", { ...H, "X-Branch-Id": "999999" })).status));
  const other = await sql("SELECT branch_id FROM branches WHERE company_id=? AND branch_id<>? LIMIT 1", [C, B]);
  if (other[0]) {
    const o = await call("/operations/trips?limit=100", { ...H, "X-Branch-Id": String(other[0].branch_id) });
    const mine = new Set((await sql(`SELECT trip_ticket_id id FROM trip_tickets tt WHERE ${SCOPE}`, sp())).map((r) => r.id));
    check(g, "another branch's list never contains this branch's trips", o.status !== 200 || o.body.data.every((t) => !mine.has(t.trip_ticket_id)), `status ${o.status}`);
  }
}

// G. barangay options
{
  const g = "G options";
  const s = (await call("/operations/trips/summary")).body.data;
  const expected = (await sql(
    `SELECT b FROM (SELECT origin_barangay b FROM trip_tickets tt WHERE ${SCOPE} UNION SELECT destination_barangay FROM trip_tickets tt WHERE ${SCOPE}
       UNION SELECT ts.stop_barangay FROM trip_stops ts JOIN trip_tickets tt ON tt.trip_ticket_id = ts.trip_ticket_id WHERE ${SCOPE}) u
      WHERE b IS NOT NULL AND b <> '' ORDER BY b`, sp(...sp(), ...sp()))).map((r) => r.b);
  check(g, "the barangay options equal SQL's distinct list (origin, destination and stops)", JSON.stringify(s.barangays) === JSON.stringify(expected), `${s.barangays.length} vs ${expected.length}`);
  check(g, "a stop-only barangay is offered", s.barangays.includes("QAStopOnly"));
}

// H. timing
{
  const g = "H speed";
  const ms = async (path) => { const best = []; for (let i = 0; i < 5; i += 1) { const t = performance.now(); await call(path); best.push(performance.now() - t); } return Math.min(...best); };
  const t = { "summary": await ms("/operations/trips/summary"), "page 1": await ms("/operations/trips?limit=20"), "last page": await ms(`/operations/trips?page=${Math.ceil(total / 20)}&limit=20`),
    "status filter": await ms("/operations/trips?status=in_transit"), "search": await ms("/operations/trips?search=depot"), "driver search": await ms("/operations/trips?search=Juan") };
  console.log("timings, best of 5, ms incl. HTTP:", Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Math.round(v)])));
  check(g, `every call answers in under 500 ms at ${total} trips`, Object.values(t).every((v) => v < 500));
}

/* ------------------------------------------------------------------ report */
const byGroup = {};
for (const r of results) { byGroup[r.group] ??= { pass: 0, fail: 0 }; byGroup[r.group][r.ok ? "pass" : "fail"] += 1; }
console.log("\nBy group:", Object.entries(byGroup).map(([g, v]) => `${g}: ${v.pass}/${v.pass + v.fail}`).join("  |  "));
console.log(`\n${pass} passed, ${fail} failed.`);
if (!KEEP) console.log("(fixtures remain until you run: node scripts/qa-trips.mjs clean)");
await db.end();
process.exit(fail ? 1 : 0);
