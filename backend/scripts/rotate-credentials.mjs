/**
 * Replace the shared demo credentials with real ones.
 *
 * Every staff account seeded for demonstration shares one password, and the
 * driver PINs are four digits. That is fine while the system answers only on a
 * laptop. The moment it has a public address, a published password is a way in
 * for anyone who has ever seen the demo, and throttling does not help when the
 * secret was never secret.
 *
 * This prints each new credential exactly once. Nothing recoverable is stored:
 * the database keeps only bcrypt hashes, so a password not written down here is
 * gone and has to be rotated again.
 *
 *   npm run creds:rotate -- --staff --confirm
 *   npm run creds:rotate -- --drivers --confirm
 *   npm run creds:rotate -- --all --confirm
 *   npm run creds:rotate -- --staff --email superadmin@gmail.com --confirm
 *
 * Without --confirm it reports what it would change and stops, so a demo is
 * never locked out by a half-remembered command.
 */
import "../src/config/env.js";
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import db from "../src/config/db.js";

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const arg = (n, d = null) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d;
};

const doStaff = flag("staff") || flag("all");
const doDrivers = flag("drivers") || flag("all");
const confirmed = flag("confirm");
const onlyEmail = arg("email");

if (!doStaff && !doDrivers) {
  console.log("\nNothing selected. Pass --staff, --drivers or --all (and --confirm to apply).\n");
  await db.end();
  process.exit(0);
}

// Ambiguous characters are left out: a password read aloud or copied off a
// screen should not depend on telling O from 0.
const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const password = (len = 16) =>
  Array.from(crypto.randomBytes(len), (b) => ALPHABET[b % ALPHABET.length]).join("");

/** A six-digit PIN, uniformly drawn — a hundred times the space of four. */
const pin = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");

const changes = [];

if (doStaff) {
  const [users] = onlyEmail
    ? await db.execute(
        "SELECT user_id, email, first_name, last_name FROM users WHERE email = ? AND status = 'active'",
        [onlyEmail]
      )
    : await db.query("SELECT user_id, email, first_name, last_name FROM users WHERE status = 'active' ORDER BY user_id");

  if (onlyEmail && !users.length) {
    console.error(`\nNo active user with the email ${onlyEmail}.\n`);
    await db.end();
    process.exit(1);
  }
  for (const u of users) {
    changes.push({ kind: "staff", id: u.user_id, who: `${u.first_name} ${u.last_name}`, login: u.email, secret: password() });
  }
}

if (doDrivers) {
  const [drivers] = await db.query(
    `SELECT driver_id, employee_no, first_name, last_name FROM drivers
      WHERE status = 'active' AND app_enabled = 1 ORDER BY employee_no`
  );
  for (const d of drivers) {
    changes.push({ kind: "driver", id: d.driver_id, who: `${d.first_name} ${d.last_name}`, login: d.employee_no, secret: pin() });
  }
}

if (!changes.length) {
  console.log("\nNothing to rotate.\n");
  await db.end();
  process.exit(0);
}

if (!confirmed) {
  console.log(`\nWould rotate ${changes.length} credential(s):\n`);
  for (const c of changes) console.log(`  ${c.kind.padEnd(7)} ${c.login.padEnd(28)} ${c.who}`);
  console.log("\nNothing was changed. Add --confirm to apply.\n");
  await db.end();
  process.exit(0);
}

for (const c of changes) {
  const hash = await bcrypt.hash(c.secret, 10);
  if (c.kind === "staff") {
    await db.execute("UPDATE users SET password_hash = ? WHERE user_id = ?", [hash, c.id]);
  } else {
    await db.execute("UPDATE drivers SET pin_hash = ? WHERE driver_id = ?", [hash, c.id]);
  }
}

console.log(`\n  ${changes.length} credential(s) rotated. Written down here and nowhere else:\n`);
console.log(`  ${"TYPE".padEnd(7)} ${"SIGN IN WITH".padEnd(28)} ${"NEW SECRET".padEnd(18)} NAME`);
console.log(`  ${"-".repeat(7)} ${"-".repeat(28)} ${"-".repeat(18)} ${"-".repeat(20)}`);
for (const c of changes) {
  console.log(`  ${c.kind.padEnd(7)} ${c.login.padEnd(28)} ${c.secret.padEnd(18)} ${c.who}`);
}
console.log(`
  Save these now — the database holds only hashes, so this list cannot be
  recovered. Anyone still holding the old password has lost access.
`);

await db.end();
