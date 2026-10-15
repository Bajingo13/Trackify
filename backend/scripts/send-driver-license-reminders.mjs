/**
 * Send driver-licence reminders now, instead of waiting for the daily sweep.
 *
 *   npm run driver-license:remind                -- list what would be sent
 *   npm run driver-license:remind -- --send      -- send it
 *
 * The same sweep the server runs every day, with the same rule that a given
 * reminder is only ever sent once per audience — so running this twice, or
 * alongside the server, cannot notify anybody twice.
 */
import "../src/config/env.js";
import db from "../src/config/db.js";
import { sendDriverLicenseReminders } from "../src/shared/driverLicenseReminders.js";
import { describeExpiry } from "../src/shared/driverLicense.js";

const send = process.argv.includes("--send");

try {
  const result = await sendDriverLicenseReminders({ dryRun: !send });
  if (result.driver.skipped) console.error(result.driver.skipped);
  if (result.office.skipped) console.error(result.office.skipped);

  if (!send) {
    console.log(`${result.due.length} notice(s) due (of ${result.considered} licence(s) expiring soon or just expired):`);
    for (const d of result.due) {
      console.log(`  ${d.company}: ${d.driver} — ${describeExpiry(d.daysLeft)} (${d.expiry}) → ${d.audiences.join(" + ")}`);
    }
    if (result.due.length) console.log("Run again with --send to send them.");
  } else {
    console.log(`Drivers notified: ${result.driver.sent.length} (${result.driver.notified} device(s)).`);
    console.log(`Office emailed about ${result.office.sent.length} licence(s); held back ${result.office.released.length}.`);
    for (const s of result.office.sent) console.log(`  ${s.company}: ${s.driver} → ${s.recipients} manager(s)`);
    for (const r of result.office.released) console.log(`  ${r.company}: ${r.driver} not sent — ${r.reason}`);
  }
} finally {
  await db.end();
}
