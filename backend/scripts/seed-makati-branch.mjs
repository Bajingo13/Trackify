/**
 * Adds a Makati branch and a manager for it, and lets the admins move between
 * branches so the operating-context switcher has somewhere to go.
 *
 * Branch and user are created through the application's own endpoints so they
 * are validated and audited. The extra access rows for the two admin accounts
 * are written directly, because granting an existing user a second scope is
 * not something the admin API exposes yet.
 */
import "../src/config/env.js";
import db from "../src/config/db.js";

const API = "http://localhost:5000";

const login = async (email) => {
  const r = await fetch(`${API}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "demo123" }),
  });
  const j = await r.json();
  const a = j.data.access?.[0] || {};
  return {
    Authorization: `Bearer ${j.data.token}`,
    "X-Company-Id": String(a.company_id),
    "X-Branch-Id": String(a.branch_id),
    "Content-Type": "application/json",
  };
};

const H = await login("superadmin@gmail.com");

// ---- 1. the branch ----
let [[makati]] = await db.execute("SELECT branch_id FROM branches WHERE branch_name = ?", ["Makati Branch"]);
if (!makati) {
  const res = await fetch(`${API}/api/v1/admin/branches`, {
    method: "POST", headers: H,
    body: JSON.stringify({ branchName: "Makati Branch", branchCode: "MKT", prefix: "MKT" }),
  });
  const body = await res.json();
  if (!res.ok) { console.error("branch create failed:", body.message); process.exit(1); }
  [[makati]] = await db.execute("SELECT branch_id FROM branches WHERE branch_name = ?", ["Makati Branch"]);
  console.log(`created Makati Branch (id ${makati.branch_id})`);
} else {
  console.log(`Makati Branch already exists (id ${makati.branch_id})`);
}

// ---- 2. a manager who lives there ----
const [[bmRole]] = await db.execute("SELECT role_id FROM roles WHERE role_name = ?", ["Branch Manager"]);
const [[existing]] = await db.execute("SELECT user_id FROM users WHERE email = ?", ["makatimanager@gmail.com"]);
if (!existing) {
  const res = await fetch(`${API}/api/v1/admin/users`, {
    method: "POST", headers: H,
    body: JSON.stringify({
      email: "makatimanager@gmail.com",
      firstName: "Makati",
      lastName: "Manager",
      // the app requires 8+ characters; the older seeded accounts predate that
      // rule, so this one deliberately differs rather than bypassing it
      password: "demo1234",
      roleIds: [bmRole.role_id],
      branchId: makati.branch_id,
    }),
  });
  const body = await res.json();
  if (!res.ok) { console.error("user create failed:", body.message); process.exit(1); }
  console.log("created makatimanager@gmail.com (Branch Manager, Makati)");
} else {
  console.log("makatimanager@gmail.com already exists");
}

// ---- 3. let the two admin accounts move between branches ----
const [branches] = await db.execute("SELECT branch_id, branch_name FROM branches WHERE company_id = 1 ORDER BY branch_id");
for (const email of ["superadmin@gmail.com", "companyadmin@gmail.com"]) {
  const [[u]] = await db.execute("SELECT user_id FROM users WHERE email = ?", [email]);
  let added = 0;
  for (const b of branches) {
    const [[has]] = await db.execute(
      "SELECT access_id FROM user_company_access WHERE user_id = ? AND company_id = 1 AND branch_id = ?",
      [u.user_id, b.branch_id]
    );
    if (!has) {
      await db.execute(
        "INSERT INTO user_company_access (user_id, company_id, branch_id, status) VALUES (?, 1, ?, 'active')",
        [u.user_id, b.branch_id]
      );
      added += 1;
    }
  }
  const [[n]] = await db.execute(
    "SELECT COUNT(*) c FROM user_company_access WHERE user_id = ? AND status = 'active'",
    [u.user_id]
  );
  console.log(`${email}: +${added} branch(es), now ${n.c} scopes`);
}

// ---- 4. give Makati something to show, so switching is not an empty screen ----
// created through the API in the Makati context: the trip number, audit trail
// and defaults all come out right, which raw inserts do not give us
const [[hasTrips]] = await db.execute("SELECT COUNT(*) n FROM trip_tickets WHERE branch_id = ?", [makati.branch_id]);
if (Number(hasTrips.n) === 0) {
  const [[cust]] = await db.execute("SELECT customer_id FROM customers WHERE company_id = 1 LIMIT 1");
  const MH = { ...H, "X-Branch-Id": String(makati.branch_id) };
  const runs = [
    ["Makati, Metro Manila, Philippines", "Batangas City, Batangas, Philippines"],
    ["Makati, Metro Manila, Philippines", "Calamba, Laguna, Philippines"],
    ["Makati, Metro Manila, Philippines", "Alabang, Muntinlupa, Philippines"],
  ];
  let made = 0;
  for (const [origin, destination] of runs) {
    const res = await fetch(`${API}/api/v1/operations/trips`, {
      method: "POST", headers: MH,
      body: JSON.stringify({
        customerId: cust?.customer_id ?? null,
        purpose: "delivery",
        origin, destination,
        priority: "normal",
        scheduledDeparture: new Date(Date.now() + 864e5).toISOString().slice(0, 19).replace("T", " "),
        scheduledArrival: new Date(Date.now() + 1728e5).toISOString().slice(0, 19).replace("T", " "),
        cargoDescription: "General freight",
      }),
    });
    if (res.ok) made += 1;
    else console.log("  trip refused:", (await res.json().catch(() => ({}))).message);
  }
  console.log(`seeded ${made} trips in Makati so the branch is not empty`);
} else {
  console.log(`Makati already has ${hasTrips.n} trips`);
}

const [summary] = await db.execute(
  `SELECT b.branch_name, COUNT(t.trip_ticket_id) trips
     FROM branches b LEFT JOIN trip_tickets t ON t.branch_id = b.branch_id
    WHERE b.company_id = 1 GROUP BY b.branch_id ORDER BY b.branch_id`
);
console.table(summary);

await db.end();
