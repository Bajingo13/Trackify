import db from "../config/db.js";
import { isMailConfigured, send } from "./mailer.js";
import { enforcementEnabled, licenseState, SYSTEM_CODE } from "./license.js";
import { licenseReminderEmail } from "./license.email.js";
import { companyAdminUserIds } from "./companyAdmins.js";

/**
 * Tell a client's administrators, by email, before their license ends.
 *
 * The in-app banner only reaches people who happen to sign in during the last
 * month. This reaches the people who can act on it, wherever they are.
 *
 * A license gets one email at each of 30, 14, 7 and 1 day(s) before it ends,
 * and one when it has just expired. Rules that keep this from being noise:
 *
 *   • One email per threshold, ever. A row in license_reminders, keyed by
 *     (license, end date, threshold), is claimed BEFORE anything is sent — so a
 *     restart, a second server instance or a manual re-run cannot send twice.
 *     If nothing could be delivered the claim is released and the next sweep
 *     tries again.
 *   • Only the most urgent threshold is sent. A license first seen at 5 days
 *     gets the 7-day email, not 30, 14 and 7 in one burst.
 *   • Renewing moves the end date, which starts a fresh cycle.
 *   • "Expired" is sent only within two weeks of the end date, so turning this
 *     on never mass-mails clients about licenses that lapsed long ago.
 *   • Revoked licenses and suspended companies get nothing: that was a
 *     decision, not an oversight to be reminded about.
 *   • It never pretends: with no mail configured it does nothing and says so.
 *
 * Recipients are the company's own administrators (not System Administrators,
 * who would otherwise be mailed once per client). A company with no active
 * administrator falls back to its contact email.
 */

export const REMINDER_THRESHOLDS = [30, 14, 7, 1];
export const EXPIRED_NOTICE_WINDOW_DAYS = 14;
const DAY = 86_400_000;

let mail = { isMailConfigured, send };
/** Swap mail out in tests. Pass nothing to put the real one back. */
export function __setLicenseMail(fake) {
  mail = fake ?? { isMailConfigured, send };
}

const frontendBase = () => (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/+$/, "");
const reference = (id) => `LIC-${String(id).padStart(6, "0")}`;

const formatDay = (date) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" }).format(date);

/**
 * Which reminder is due for a license today: a threshold in days (30/14/7/1),
 * 0 for "has just expired", or null for none.
 */
export function dueThreshold(row, now = new Date()) {
  if (!row?.expires_at) return null;
  const { state, daysRemaining } = licenseState(row, now);
  if (state === "revoked" || state === "missing") return null;
  if (state === "expired") {
    const lapsedDays = (now.getTime() - new Date(row.expires_at).getTime()) / DAY;
    return lapsedDays <= EXPIRED_NOTICE_WINDOW_DAYS ? 0 : null;
  }
  const crossed = REMINDER_THRESHOLDS.filter((t) => daysRemaining <= t);
  return crossed.length ? Math.min(...crossed) : null;
}

/** Active administrators of the company who can be written to, System Administrators excluded. */
export async function reminderRecipients(runner, companyId) {
  const adminIds = [...(await companyAdminUserIds(runner, companyId))];
  let people = [];
  if (adminIds.length) {
    const marks = adminIds.map(() => "?").join(", ");
    const [rows] = await runner.query(
      `SELECT u.user_id, u.email, u.first_name
         FROM users u
        WHERE u.user_id IN (${marks}) AND u.status = 'active' AND u.email IS NOT NULL AND u.email <> ''
          AND NOT EXISTS (
            SELECT 1 FROM user_roles ur
              JOIN role_permissions rp ON rp.role_id = ur.role_id
              JOIN permissions p ON p.permission_id = rp.permission_id
             WHERE ur.user_id = u.user_id AND ur.status = 'active' AND p.permission_code = 'system.admin'
          )`,
      adminIds
    );
    people = rows.map((r) => ({ email: r.email, name: r.first_name }));
  }
  if (!people.length) {
    const [[company]] = await runner.query("SELECT email FROM companies WHERE company_id = ?", [companyId]);
    if (company?.email) people = [{ email: company.email, name: null }];
  }
  return people;
}

/**
 * One sweep. Returns what it did, so a scheduled run, a script and a test all
 * read the same account:
 *   { skipped?, considered, due: [...], sent: [...], released: [...] }
 */
export async function sendLicenseReminders({ runner = db, now = new Date(), dryRun = false, systemCode = SYSTEM_CODE, companyId = null } = {}) {
  const result = { considered: 0, due: [], sent: [], released: [] };

  if (!dryRun && !mail.isMailConfigured()) {
    return { ...result, skipped: "Email is not set up on this server, so no license reminders were sent." };
  }

  const [rows] = await runner.execute(
    `SELECT l.license_id, l.license_number, l.status, l.expires_at, c.company_id, c.company_name
       FROM licenses l JOIN companies c ON c.company_id = l.company_id
      WHERE l.system_code = ? AND l.status = 'active' AND c.status = 'active'
        AND l.expires_at IS NOT NULL
        AND l.expires_at > ? AND l.expires_at <= ?
        AND (? IS NULL OR c.company_id = ?)
      ORDER BY l.expires_at ASC`,
    [
      systemCode,
      new Date(now.getTime() - EXPIRED_NOTICE_WINDOW_DAYS * DAY),
      new Date(now.getTime() + (REMINDER_THRESHOLDS[0] + 1) * DAY),
      companyId,
      companyId,
    ]
  );
  result.considered = rows.length;

  for (const row of rows) {
    const threshold = dueThreshold(row, now);
    if (threshold === null) continue;
    const item = { licenseId: row.license_id, company: row.company_name, threshold };

    if (dryRun) {
      const [[done]] = await runner.execute(
        "SELECT COUNT(*) AS n FROM license_reminders WHERE license_id = ? AND expires_at = ? AND threshold_days = ?",
        [row.license_id, row.expires_at, threshold]
      );
      if (!Number(done.n)) result.due.push(item);
      continue;
    }

    // Claim first. The unique key means exactly one caller gets to send.
    const [claim] = await runner.execute(
      "INSERT IGNORE INTO license_reminders (license_id, expires_at, threshold_days) VALUES (?, ?, ?)",
      [row.license_id, row.expires_at, threshold]
    );
    if (!claim.affectedRows) continue;
    result.due.push(item);

    const release = async (reason) => {
      await runner.execute("DELETE FROM license_reminders WHERE reminder_id = ?", [claim.insertId]);
      result.released.push({ ...item, reason });
    };

    const recipients = await reminderRecipients(runner, row.company_id);
    if (!recipients.length) {
      await release("no administrator or company email to write to");
      continue;
    }

    const state = licenseState(row, now);
    let delivered = 0;
    for (const person of recipients) {
      const message = licenseReminderEmail({
        name: person.name,
        companyName: row.company_name,
        licenseNumber: row.license_number,
        expires: formatDay(new Date(row.expires_at)),
        daysLeft: state.daysRemaining,
        expired: threshold === 0,
        url: `${frontendBase()}/admin/settings/license`,
        reference: reference(row.license_id),
        enforced: enforcementEnabled(),
      });
      // eslint-disable-next-line no-await-in-loop
      const outcome = await mail.send({ to: person.email, ...message });
      if (outcome.sent) delivered += 1;
    }

    if (!delivered) {
      await release("no email could be delivered");
      continue;
    }
    await runner.execute("UPDATE license_reminders SET recipients = ? WHERE reminder_id = ?", [delivered, claim.insertId]);
    result.sent.push({ ...item, recipients: delivered });
  }

  return result;
}

/** At startup and daily. Never fatal, never holds the process open. */
export function scheduleLicenseReminders({
  intervalMs = 24 * 60 * 60 * 1000,
  log = console,
  sweep = sendLicenseReminders,
} = {}) {
  const run = async () => {
    try {
      const result = await sweep();
      if (result.skipped) log.log(`[license] ${result.skipped}`);
      for (const s of result.sent) log.log(`[license] Reminder (${s.threshold === 0 ? "expired" : `${s.threshold}d`}) sent to ${s.recipients} administrator(s) of ${s.company}`);
      for (const r of result.released) log.error(`[license] Reminder for ${r.company} not sent: ${r.reason}`);
    } catch (error) {
      log.error(`[license] Could not send license reminders: ${error.message}`);
    }
  };
  void run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return timer;
}
