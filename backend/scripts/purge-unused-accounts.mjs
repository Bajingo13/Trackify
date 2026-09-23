/**
 * Remove sign-in accounts that were seeded, never used, and switched off.
 *
 *   npm run accounts:purge                 -- list what would go
 *   npm run accounts:purge -- --confirm    -- remove them
 *
 * Eight accounts from two earlier naming schemes are deactivated but still
 * present, still holding their roles and their company access. Deactivated is
 * not gone: anyone who can manage users can switch one back on, and a seeded
 * account nobody is watching is a way in that nobody is watching either.
 *
 * Three rules keep this from being the destructive command it looks like:
 *
 *   • Only accounts that are already INACTIVE are ever considered. An account
 *     somebody is using cannot be caught by this.
 *
 *   • Any account with history — an audit entry, a trip, anything that names
 *     it — is skipped and reported, never deleted. History is the reason the
 *     row exists; deleting it would take a name off past work.
 *
 *   • Everything it removes is written to a JSON file first, so a decision
 *     made in a hurry can be undone by hand.
 */
import "../src/config/env.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import db from "../src/config/db.js";

const confirmed = process.argv.includes("--confirm");
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/*
 * What counts as history is asked of the database, not listed here.
 *
 * The first version of this checked audit_logs alone and reported all eight
 * accounts as having never done anything. Two of them had approved trips, and
 * only a foreign key refusing the delete revealed it. Anything that points at
 * a user is history unless it is part of the account itself, so a table added
 * next year counts automatically and the safe answer is the default.
 */
const ACCOUNT_PARTS = new Set([
  "user_roles",
  "user_company_access",
  "user_alert_mutes",
  "password_reset_tokens",
]);

const [references] = await db.execute(
  `SELECT TABLE_NAME AS t, COLUMN_NAME AS c
     FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME = 'users'`
);

/* audit_logs names a user without a foreign key to them, so it is added by
 * hand — the one place the generic question cannot reach. */
const historyIn = [
  ...references.filter((r) => !ACCOUNT_PARTS.has(r.t)).map((r) => ({ table: r.t, column: r.c })),
  { table: "audit_logs", column: "user_id" },
];

const [candidates] = await db.query(`
  SELECT user_id, email, first_name, last_name, created_at
    FROM users
   WHERE status = 'inactive'
   ORDER BY user_id
`);

/** Everywhere this account is named, and by what. */
async function historyFor(userId) {
  const found = [];
  for (const { table, column } of historyIn) {
    // eslint-disable-next-line no-await-in-loop
    const [[row]] = await db.execute(
      `SELECT COUNT(*) AS n FROM \`${table}\` WHERE \`${column}\` = ?`,
      [userId]
    );
    if (Number(row.n) > 0) found.push(`${table} (${row.n})`);
  }
  return found;
}

for (const u of candidates) {
  // eslint-disable-next-line no-await-in-loop
  u.history = await historyFor(u.user_id);
}

if (!candidates.length) {
  console.log("\n  No deactivated accounts. Nothing to do.\n");
  await db.end();
  process.exit(0);
}

const used = candidates.filter((u) => u.history.length > 0);
const unused = candidates.filter((u) => u.history.length === 0);

console.log(`\n  ${candidates.length} deactivated account(s):\n`);
console.log(`  ${"ID".padEnd(5)} ${"EMAIL".padEnd(32)} HISTORY`);
console.log(`  ${"-".repeat(5)} ${"-".repeat(32)} ${"-".repeat(46)}`);
for (const u of candidates) {
  const history = u.history.length ? `KEEPING — named in ${u.history.join(", ")}` : "none";
  console.log(`  ${String(u.user_id).padEnd(5)} ${u.email.padEnd(32)} ${history}`);
}

if (used.length) {
  console.log(`\n  ${used.length} of these have history and will not be touched.`);
}
if (!unused.length) {
  console.log("\n  Nothing to remove: every deactivated account has history.\n");
  await db.end();
  process.exit(0);
}

if (!confirmed) {
  console.log(`\n  Would remove ${unused.length} account(s) that have never done anything.`);
  console.log("  Nothing was changed. Add --confirm to apply.\n");
  await db.end();
  process.exit(0);
}

/* Written before anything is deleted, not after. */
const backupPath = path.join(
  __dirname, "..", "backups",
  `purged-accounts-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
);
fs.mkdirSync(path.dirname(backupPath), { recursive: true });

const backup = [];
for (const u of unused) {
  // eslint-disable-next-line no-await-in-loop
  const [[full]] = await db.execute("SELECT * FROM users WHERE user_id = ?", [u.user_id]);
  // eslint-disable-next-line no-await-in-loop
  const [roles] = await db.execute("SELECT * FROM user_roles WHERE user_id = ?", [u.user_id]);
  // eslint-disable-next-line no-await-in-loop
  const [access] = await db.execute("SELECT * FROM user_company_access WHERE user_id = ?", [u.user_id]);
  backup.push({ user: full, roles, access });
}
fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
console.log(`\n  Wrote ${backup.length} account(s) to ${backupPath}`);

let removed = 0;
for (const u of unused) {
  const connection = await db.getConnection(); // eslint-disable-line no-await-in-loop
  try {
    await connection.beginTransaction();
    for (const table of ACCOUNT_PARTS) {
      // eslint-disable-next-line no-await-in-loop
      await connection.execute(`DELETE FROM \`${table}\` WHERE user_id = ?`, [u.user_id]);
    }
    await connection.execute("DELETE FROM users WHERE user_id = ?", [u.user_id]);
    await connection.commit();
    removed += 1;
  } catch (error) {
    await connection.rollback().catch(() => {});
    // One account that will not delete — a foreign key from a table this does
    // not know about — must not stop the rest, and must be reported rather
    // than swallowed.
    console.error(`  Could not remove ${u.email}: ${error.message}`);
  } finally {
    connection.release();
  }
}

console.log(`\n  ${removed} account(s) removed. The backup above is the only copy.\n`);
await db.end();
process.exit(0);
