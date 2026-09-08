/**
 * Can someone sit and guess a driver's four-digit PIN?
 *
 * Walks wrong PINs at the live API and checks the door closes, that a good
 * credential is still refused while the block stands, and that an untouched
 * account is unaffected.
 */
const API = "http://localhost:5000";
let pass = 0, fail = 0;
const check = (n, c, x = "") => { if (c) { pass++; console.log(`ok    ${n}`); } else { fail++; console.log(`FAIL  ${n} ${x}`); } };

const driverLogin = (employeeNo, pin) =>
  fetch(`${API}/api/v1/driver/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ employeeNo, pin }),
  });

const staffLogin = (email, password) =>
  fetch(`${API}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

// ---- a PIN sweep against one driver ----
const codes = [];
for (let i = 0; i < 8; i++) {
  const r = await driverLogin("DRV-001", String(9000 + i));
  codes.push(r.status);
}
console.log(`      DRV-001 wrong PINs -> ${codes.join(" ")}\n`);

check("the first wrong PIN is simply refused", codes[0] === 401, `got ${codes[0]}`);
check("the sweep is cut off", codes.includes(429), codes.join(","));
check("it stops within 6 tries", codes.indexOf(429) <= 5, `first 429 at #${codes.indexOf(429) + 1}`);

const blocked = await driverLogin("DRV-001", "1234");   // the REAL pin
check("the correct PIN is refused while blocked", blocked.status === 429, `status=${blocked.status}`);

const body = await blocked.json();
check("it says when to come back", /minute/i.test(body.message || ""), body.message);
check("it sets Retry-After", !!blocked.headers.get("retry-after"), String(blocked.headers.get("retry-after")));

// ---- a different driver is not punished for it ----
const other = await driverLogin("DRV-002", "0000");
check("another driver is unaffected", other.status === 401, `status=${other.status}`);

// ---- staff login throttles on its own counter ----
const staffCodes = [];
for (let i = 0; i < 7; i++) {
  const r = await staffLogin("superadmin@gmail.com", `wrong${i}`);
  staffCodes.push(r.status);
}
console.log(`\n      staff wrong passwords -> ${staffCodes.join(" ")}\n`);
check("staff sweep is cut off too", staffCodes.includes(429), staffCodes.join(","));

// ---- a clean account still works ----
const clean = await staffLogin("dispatcher@gmail.com", "demo123");
check("an untouched account still signs in", clean.ok, `status=${clean.status}`);

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exitCode = fail ? 1 : 0;
