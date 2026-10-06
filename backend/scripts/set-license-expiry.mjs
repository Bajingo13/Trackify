/**
 * Move one client's license end date, to try the expiry reminders on a
 * development database.
 *
 *   npm run license:set-expiry -- ABL 6              -- ends 6 days from now
 *   npm run license:set-expiry -- ABL 0.5            -- ends in 12 hours
 *   npm run license:set-expiry -- ABL -2             -- ended 2 days ago
 *   npm run license:set-expiry -- ABL 365            -- put it back to a year
 *   npm run license:set-expiry -- ABL 6 --fresh      -- also forget reminders already sent
 *
 * Days from now, so the same command both sets up a test and undoes it. It
 * prints the end date it replaced, so nothing is lost by trying it.
 *
 * Development only. Moving an end date by hand is exactly what a real renewal
 * is NOT: it skips the audit trail that Settings -> License keeps. So it
 * refuses a production-looking database outright, with the same guard the test
 * suite and the seed scripts use.
 */
import "../src/config/env.js";
import { refuseProductionDatabase } from "../src/shared/productionDatabaseGuard.js";
import db from "../src/config/db.js";

refuseProductionDatabase("license:set-expiry");

const [code, daysArg] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const fresh = process.argv.includes("--fresh");
const days = Number(daysArg);

if (!code || daysArg === undefined || !Number.isFinite(days)) {
  console.error("Usage: npm run license:set-expiry -- <COMPANY_CODE> <days from now> [--fresh]");
  process.exit(1);
}

try {
  const [[license]] = await db.execute(
    `SELECT l.license_id, l.status, l.expires_at, c.company_name
       FROM licenses l JOIN companies c ON c.company_id = l.company_id
      WHERE c.company_code = ?`,
    [code.toUpperCase()]
  );
  if (!license) {
    console.error(`No license found for company code "${code.toUpperCase()}".`);
    process.exitCode = 1;
  } else {
    const next = new Date(Date.now() + days * 86_400_000);
    await db.execute("UPDATE licenses SET expires_at = ? WHERE license_id = ?", [next, license.license_id]);
    if (fresh) await db.execute("DELETE FROM license_reminders WHERE license_id = ?", [license.license_id]);

    const show = (d) => (d ? new Date(d).toLocaleString() : "no end date");
    console.log(`${license.company_name} (${code.toUpperCase()})`);
    console.log(`  was: ${show(license.expires_at)}`);
    console.log(`  now: ${show(next)}`);
    if (license.status !== "active") console.log(`  note: the license is ${license.status}, so no reminder will be sent for it.`);
    if (fresh) console.log("  earlier reminders for this license were cleared.");
    console.log("Next: npm run license:remind   (preview)   then   npm run license:remind -- --send");
  }
} finally {
  await db.end();
}
