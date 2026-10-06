/**
 * Send license-expiry reminders now, instead of waiting for the daily sweep.
 *
 *   npm run license:remind                -- list what would be sent
 *   npm run license:remind -- --send      -- send it
 *
 * The same sweep the server runs every day, with the same rule that a given
 * reminder is only ever sent once — so running this twice, or alongside the
 * server, cannot double-mail anybody.
 */
import "../src/config/env.js";
import db from "../src/config/db.js";
import { sendLicenseReminders } from "../src/shared/licenseReminders.js";

const send = process.argv.includes("--send");

try {
  const result = await sendLicenseReminders({ dryRun: !send });
  if (result.skipped) {
    console.error(result.skipped);
    process.exitCode = 1;
  } else if (!send) {
    console.log(`${result.due.length} reminder(s) due (of ${result.considered} license(s) ending soon):`);
    for (const d of result.due) console.log(`  ${d.company}: ${d.threshold === 0 ? "expired notice" : `${d.threshold}-day warning`}`);
    if (result.due.length) console.log("Run again with --send to email them.");
  } else {
    console.log(`Sent ${result.sent.length}; held back ${result.released.length}.`);
    for (const s of result.sent) console.log(`  ${s.company}: ${s.threshold === 0 ? "expired notice" : `${s.threshold}-day warning`} to ${s.recipients}`);
    for (const r of result.released) console.log(`  ${r.company}: not sent — ${r.reason}`);
  }
} finally {
  await db.end();
}
