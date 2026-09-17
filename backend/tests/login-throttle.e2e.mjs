/**
 * Can someone sit and guess a driver's four-digit PIN?
 *
 * Deliberately sweeps identities no other test depends on. A blocked identity
 * stays blocked for fifteen minutes and that state lives in the server's
 * memory, so sweeping DRV-001 or superadmin here would fail every driver and
 * UI test that ran afterwards — which is exactly what happened the first time.
 *
 * The correct-credential-still-refused case needs a real account, so it uses
 * the auditor, which nothing else signs in as.
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

// ---- a PIN sweep against one driver identity ----
const GHOST = "DRV-QA-SWEEP";
const codes = [];
for (let i = 0; i < 8; i++) codes.push((await driverLogin(GHOST, String(9000 + i))).status);
console.log(`      ${GHOST} wrong PINs -> ${codes.join(" ")}\n`);

check("the first wrong PIN is simply refused", codes[0] === 401, `got ${codes[0]}`);
check("the sweep is cut off", codes.includes(429), codes.join(","));
check("it stops within 6 tries", codes.indexOf(429) >= 0 && codes.indexOf(429) <= 5, `first 429 at #${codes.indexOf(429) + 1}`);

const body = await (await driverLogin(GHOST, "0000")).json();
check("it says when to come back", /minute/i.test(body.message || ""), body.message);

// ---- a driver who was not being guessed at is unaffected ----
const other = await driverLogin("DRV-001", "0000");
check("a real driver is not caught in it", other.status === 401, `status=${other.status}`);

// ---- a correct credential is refused while the block stands ----
const VICTIM = "auditor@gmail.com";
const staffCodes = [];
for (let i = 0; i < 6; i++) staffCodes.push((await staffLogin(VICTIM, `wrong${i}`)).status);
console.log(`\n      ${VICTIM} wrong passwords -> ${staffCodes.join(" ")}\n`);

check("staff sweep is cut off too", staffCodes.includes(429), staffCodes.join(","));

const blocked = await staffLogin(VICTIM, "demo123");   // the REAL password
check("the correct password is refused while blocked", blocked.status === 429, `status=${blocked.status}`);
check("it sets Retry-After", !!blocked.headers.get("retry-after"), String(blocked.headers.get("retry-after")));

// ---- everyone else carries on ----
const clean = await staffLogin("dispatcher@gmail.com", "demo123");
check("an untouched account still signs in", clean.ok, `status=${clean.status}`);

// ---- put the server back as we found it ----
// This suite blocks two identities for fifteen minutes in the server's own
// memory. Left there, a second run inside that window fails on the throttle
// rather than on anything real, and the failure reads like a broken login.
const reset = await fetch(`${API}/api/auth/throttle-reset`, { method: "POST" });
check("the throttle can be cleared afterwards", reset.ok, `status=${reset.status}`);

const reopened = await staffLogin(VICTIM, "demo123");
check("the blocked account signs in again once cleared", reopened.ok, `status=${reopened.status}`);
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exitCode = fail ? 1 : 0;
