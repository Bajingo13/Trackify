import db from "../config/db.js";
import { isProduction } from "./environment.js";
import { isMailConfigured, send } from "./mailer.js";
import { notifyDriver, pushEnabled } from "../modules/support/push.service.js";
import { driverLicenseDigestEmail } from "./driverLicense.email.js";
import {
  dueReminder, daysUntilExpiry, describeExpiry, manilaToday, dateOnly,
  LICENSE_WARNING_DAYS, LICENSE_EXPIRED_NOTICE_DAYS,
} from "./driverLicense.js";

/**
 * Warn drivers, and the people who manage them, as a driver licence runs out.
 *
 * The in-app indicators (the amber/red licence card, the Compliance bell, the
 * badge in the driver list) only reach someone who happens to open that screen.
 * This reaches them wherever they are: a push notification to the driver's
 * phone, and one email a day to the company's driver managers listing every
 * licence that has just crossed a threshold.
 *
 * Thresholds are 60, 30, 14, 7 and 1 day(s) before the expiry date, and a
 * notice when it has just expired. The rules that keep this from being noise:
 *
 *   • One notice per threshold, per audience, ever. A row in
 *     driver_license_reminders, keyed by (driver, expiry date, threshold,
 *     audience), is claimed BEFORE anything is sent, so a restart, a second
 *     server instance or a manual re-run cannot send twice.
 *   • Only the most urgent threshold crossed. A licence first noticed at 5 days
 *     gets the 7-day notice, not 60, 30, 14 and 7 in one burst.
 *   • Renewing moves the expiry date, which starts a fresh cycle.
 *   • "Expired" is announced only within two weeks of the date, so switching
 *     this on never announces licences that lapsed long ago.
 *   • Inactive drivers and suspended companies get nothing.
 *   • It never pretends: with no push keys the driver side is skipped, with no
 *     mail the office side is, and both say so rather than claim a send.
 *
 * Driver notices are kept once claimed even if no phone received them: the
 * driver may have no app installed or notifications off, and retrying a dead
 * subscription every day helps nobody. The licence card in the app is the
 * always-on channel. Office notices are different — a person who manages
 * drivers must hear — so their claim is released if nothing could be delivered
 * and the next sweep tries again.
 */

const DAY = 86_400_000;

let mail = { isMailConfigured, send };
let phone = { pushEnabled, notifyDriver };
/** Swap mail out in tests. Pass nothing to put the real one back. */
export function __setReminderMail(fake) { mail = fake ?? { isMailConfigured, send }; }
/** Swap phone notifications out in tests. Pass nothing to put the real one back. */
export function __setReminderPush(fake) { phone = fake ?? { pushEnabled, notifyDriver }; }

const frontendBase = () => (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/+$/, "");
const fullName = (d) => `${d.first_name} ${d.last_name}`.trim();

/** What a lock screen may say: that the date is near, never anything more. */
export function pushText(daysLeft) {
  if (daysLeft < 0) {
    return { title: "Your licence has expired", body: "Open the app to update your licence details. You can't be assigned trips until they're renewed." };
  }
  return {
    title: "Your licence is expiring",
    body: `Your driver's licence ${describeExpiry(daysLeft).toLowerCase()}. Open the app to review it.`,
  };
}

/** Active users in the company who manage drivers, with an address to write to. System administrators excluded. */
export async function managerRecipients(runner, companyId) {
  const [rows] = await runner.query(
    `SELECT DISTINCT u.user_id, u.email, u.first_name
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.user_id AND ur.status = 'active' AND ur.company_id = ?
       JOIN roles r ON r.role_id = ur.role_id AND r.status = 'active'
       JOIN role_permissions rp ON rp.role_id = ur.role_id
       JOIN permissions p ON p.permission_id = rp.permission_id AND p.permission_code = 'driver.manage'
      WHERE u.status = 'active' AND u.email IS NOT NULL AND u.email <> ''
        AND NOT EXISTS (
          SELECT 1 FROM user_roles ur2
            JOIN role_permissions rp2 ON rp2.role_id = ur2.role_id
            JOIN permissions p2 ON p2.permission_id = rp2.permission_id
           WHERE ur2.user_id = u.user_id AND ur2.status = 'active' AND p2.permission_code = 'system.admin'
        )`,
    [companyId]
  );
  return rows.map((r) => ({ email: r.email, name: r.first_name }));
}

/**
 * One sweep. Returns what it did, so a scheduled run, a script and a test all
 * read the same account:
 *   { considered, due: [...], driver: { sent, notified, skipped? }, office: { sent, released, skipped? } }
 */
export async function sendDriverLicenseReminders({ runner = db, now = new Date(), dryRun = false, companyId = null } = {}) {
  const result = {
    considered: 0,
    due: [],
    driver: { sent: [], notified: 0 },
    office: { sent: [], released: [] },
  };

  const today = manilaToday(now);
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - LICENSE_EXPIRED_NOTICE_DAYS * DAY).toISOString().slice(0, 10);
  const to = new Date(Date.parse(`${today}T00:00:00Z`) + LICENSE_WARNING_DAYS * DAY).toISOString().slice(0, 10);

  const [drivers] = await runner.execute(
    `SELECT d.driver_id, d.company_id, d.employee_no, d.first_name, d.last_name,
            d.license_no, d.license_expiry, d.app_enabled, c.company_name
       FROM drivers d JOIN companies c ON c.company_id = d.company_id
      WHERE d.status <> 'inactive' AND c.status = 'active'
        AND d.license_expiry IS NOT NULL AND d.license_expiry >= ? AND d.license_expiry <= ?
        AND (? IS NULL OR d.company_id = ?)
      ORDER BY d.license_expiry ASC`,
    [from, to, companyId, companyId]
  );
  result.considered = drivers.length;

  const claim = async (driverId, expiresOn, threshold, audience) => {
    const [r] = await runner.execute(
      "INSERT IGNORE INTO driver_license_reminders (driver_id, expires_on, threshold_days, audience) VALUES (?, ?, ?, ?)",
      [driverId, expiresOn, threshold, audience]
    );
    return r.affectedRows ? r.insertId : null;
  };
  const alreadySent = async (driverId, expiresOn, threshold, audience) => {
    const [[row]] = await runner.execute(
      "SELECT COUNT(*) AS n FROM driver_license_reminders WHERE driver_id = ? AND expires_on = ? AND threshold_days = ? AND audience = ?",
      [driverId, expiresOn, threshold, audience]
    );
    return Number(row.n) > 0;
  };

  const driverChannelOpen = phone.pushEnabled();
  const officeChannelOpen = mail.isMailConfigured();
  if (!driverChannelOpen) result.driver.skipped = "Phone notifications are not set up on this server, so no driver was notified.";
  if (!officeChannelOpen) result.office.skipped = "Email is not set up on this server, so the office was not emailed.";

  const byCompany = new Map(); // company_id -> { name, claims: [{ reminderId, item }] }

  for (const d of drivers) {
    const expiresOn = dateOnly(d.license_expiry);
    const threshold = dueReminder(expiresOn, now);
    if (threshold === null) continue;
    const item = {
      driverId: d.driver_id,
      driver: fullName(d),
      employeeNo: d.employee_no,
      licenseNo: d.license_no,
      expiry: expiresOn,
      daysLeft: daysUntilExpiry(expiresOn, now),
      threshold,
      company: d.company_name,
    };

    if (dryRun) {
      const pending = [];
      if (driverChannelOpen && d.app_enabled && !(await alreadySent(d.driver_id, expiresOn, threshold, "driver"))) pending.push("driver");
      if (officeChannelOpen && !(await alreadySent(d.driver_id, expiresOn, threshold, "office"))) pending.push("office");
      if (pending.length) result.due.push({ ...item, audiences: pending });
      continue;
    }

    /* the driver's phone */
    if (driverChannelOpen && d.app_enabled) {
      const reminderId = await claim(d.driver_id, expiresOn, threshold, "driver");
      if (reminderId) {
        const text = pushText(item.daysLeft);
        const out = await phone.notifyDriver({
          companyId: d.company_id,
          driverId: d.driver_id,
          title: text.title,
          body: text.body,
          tag: "license-expiry",
        });
        await runner.execute("UPDATE driver_license_reminders SET recipients = ? WHERE reminder_id = ?", [out.sent, reminderId]);
        result.driver.sent.push({ ...item, devices: out.sent });
        result.driver.notified += out.sent;
      }
    }

    /* the office: collected, then sent as one digest per company */
    if (officeChannelOpen) {
      const reminderId = await claim(d.driver_id, expiresOn, threshold, "office");
      if (reminderId) {
        if (!byCompany.has(d.company_id)) byCompany.set(d.company_id, { name: d.company_name, claims: [] });
        byCompany.get(d.company_id).claims.push({ reminderId, item });
      }
    }
  }

  for (const [company, batch] of byCompany) {
    const release = async (reason) => {
      for (const { reminderId, item } of batch.claims) {
        // eslint-disable-next-line no-await-in-loop
        await runner.execute("DELETE FROM driver_license_reminders WHERE reminder_id = ?", [reminderId]);
        result.office.released.push({ company: batch.name, driver: item.driver, reason });
      }
    };

    const people = await managerRecipients(runner, company);
    if (!people.length) {
      await release("nobody who manages drivers has an email address on file");
      continue;
    }

    let delivered = 0;
    for (const person of people) {
      const message = driverLicenseDigestEmail({
        name: person.name,
        companyName: batch.name,
        items: batch.claims.map((c) => c.item),
        url: `${frontendBase()}/fleet/drivers`,
      });
      // eslint-disable-next-line no-await-in-loop
      const outcome = await mail.send({ to: person.email, ...message });
      if (outcome.sent) delivered += 1;
    }

    if (!delivered) {
      await release("no email could be delivered");
      continue;
    }
    for (const { reminderId, item } of batch.claims) {
      // eslint-disable-next-line no-await-in-loop
      await runner.execute("UPDATE driver_license_reminders SET recipients = ? WHERE reminder_id = ?", [delivered, reminderId]);
      result.office.sent.push({ company: batch.name, driver: item.driver, threshold: item.threshold, recipients: delivered });
    }
  }

  return result;
}

/**
 * Should the server run the sweep by itself?
 *
 * Only where there are real drivers to tell. A development database holds demo
 * drivers whose licences sit inside the windows and whose managers have real-
 * looking addresses, and a dev server restarts on every saved file — it would
 * email those addresses on every restart. DRIVER_LICENSE_REMINDERS=on opts a
 * non-production server in; `npm run driver-license:remind -- --send` always
 * works, because there somebody has asked.
 */
export function reminderScheduleEnabled(env = process.env) {
  const choice = String(env.DRIVER_LICENSE_REMINDERS || "").toLowerCase();
  if (choice === "on") return true;
  if (choice === "off") return false;
  return isProduction(env);
}

/** At startup and daily. Never fatal, never holds the process open. */
export function scheduleDriverLicenseReminders({
  intervalMs = 24 * 60 * 60 * 1000,
  log = console,
  sweep = sendDriverLicenseReminders,
  enabled = reminderScheduleEnabled(),
} = {}) {
  if (!enabled) {
    log.log("[driver-license] Automatic licence reminders are off outside production (DRIVER_LICENSE_REMINDERS=on to run them here).");
    return null;
  }
  const run = async () => {
    try {
      const result = await sweep();
      if (result.considered && result.driver.skipped) log.log(`[driver-license] ${result.driver.skipped}`);
      if (result.considered && result.office.skipped) log.log(`[driver-license] ${result.office.skipped}`);
      for (const s of result.driver.sent) {
        log.log(`[driver-license] ${describeExpiry(s.daysLeft)} — notified ${s.driver} (${s.devices} device${s.devices === 1 ? "" : "s"})`);
      }
      for (const s of result.office.sent) {
        log.log(`[driver-license] Emailed ${s.recipients} manager(s) at ${s.company} about ${s.driver}`);
      }
      for (const r of result.office.released) {
        log.error(`[driver-license] Office notice for ${r.driver} (${r.company}) not sent: ${r.reason}`);
      }
    } catch (error) {
      log.error(`[driver-license] Could not send driver licence reminders: ${error.message}`);
    }
  };
  void run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return timer;
}
