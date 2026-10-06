import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXPIRING_SOON_DAYS,
  SYSTEM_CODE,
  generateLicenseNumber,
  licenseState,
  looksLikeLicenseNumber,
  renewedExpiry,
  serializeLicense,
} from "./license.js";

const NOW = new Date("2026-06-15T00:00:00Z");
const inDays = (n) => new Date(NOW.getTime() + n * 86_400_000);

test("a license number reads SYSTEM-CLIENT-YEAR-HASH", () => {
  const number = generateLicenseNumber("acme", NOW, "EIS01");
  assert.match(number, /^EIS01-ACME-2026-[A-HJ-NP-Z2-9]{10}$/);
  assert.ok(looksLikeLicenseNumber(number));
});

test("the default system code is used when none is given", () => {
  assert.ok(generateLicenseNumber("ACME", NOW).startsWith(`${SYSTEM_CODE}-ACME-`));
});

test("the random segment never repeats across many numbers and avoids look-alike characters", () => {
  const seen = new Set();
  for (let i = 0; i < 5000; i += 1) {
    const hash = generateLicenseNumber("ACME", NOW).split("-").pop();
    assert.equal(/[01OI]/.test(hash), false, `ambiguous character in ${hash}`);
    seen.add(hash);
  }
  assert.equal(seen.size, 5000);
});

test("looksLikeLicenseNumber rejects malformed values", () => {
  for (const bad of ["", null, "TRK01-ACME-2026", "trk01-acme-2026-K7M4Q9XT2P", "TRK01-ACME-26-K7M4Q9XT2P", "TRK01-ACME-2026-SHORT"]) {
    assert.equal(looksLikeLicenseNumber(bad), false, String(bad));
  }
});

test("licenseState: missing, revoked, expired, expiring, active, perpetual", () => {
  assert.equal(licenseState(null, NOW).state, "missing");
  assert.equal(licenseState({ status: "revoked", expires_at: inDays(300) }, NOW).state, "revoked");
  assert.deepEqual(licenseState({ status: "active", expires_at: inDays(-1) }, NOW), { state: "expired", valid: false, daysRemaining: 0 });

  const soon = licenseState({ status: "active", expires_at: inDays(EXPIRING_SOON_DAYS) }, NOW);
  assert.equal(soon.state, "expiring");
  assert.equal(soon.valid, true);
  assert.equal(soon.daysRemaining, EXPIRING_SOON_DAYS);

  assert.equal(licenseState({ status: "active", expires_at: inDays(EXPIRING_SOON_DAYS + 1) }, NOW).state, "active");
  assert.deepEqual(licenseState({ status: "active", expires_at: null }, NOW), { state: "active", valid: true, daysRemaining: null });
});

test("renewal counts from the later of today and the current end", () => {
  const future = renewedExpiry(inDays(60), 12, NOW);
  assert.equal(future.getFullYear(), 2027);
  assert.ok(future > inDays(60 + 360));

  const lapsed = renewedExpiry(inDays(-200), 12, NOW);
  assert.equal(lapsed.toISOString().slice(0, 10), "2027-06-15");
});

test("serializeLicense names the number, the state and a message the client can read", () => {
  const row = {
    license_id: 1, company_id: 2, system_code: "TRK01", license_number: "TRK01-ACME-2026-K7M4Q9XT2P",
    status: "active", issued_at: NOW, expires_at: inDays(-3), revoked_at: null, revoked_reason: null,
  };
  const out = serializeLicense(row, NOW);
  assert.equal(out.state, "expired");
  assert.equal(out.valid, false);
  assert.match(out.message, /expired/i);
  assert.equal(serializeLicense(null, NOW).state, "missing");
});

test("adding months clamps to the end of a shorter month instead of spilling into the next", async () => {
  const { addMonths } = await import("./license.js");
  const day = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  assert.equal(day(addMonths(new Date(2027, 0, 31), 1)), "2027-2-28");
  assert.equal(day(addMonths(new Date(2028, 0, 31), 1)), "2028-2-29");
  assert.equal(day(addMonths(new Date(2026, 10, 30), 3)), "2027-2-28");
  assert.equal(day(addMonths(new Date(2026, 5, 15), 12)), "2027-6-15");
  assert.equal(day(addMonths(new Date(2026, 11, 31), 2)), "2027-2-28");
});

test("dueThreshold picks the single most urgent reminder, and none for revoked, perpetual or long-lapsed licenses", async () => {
  const { dueThreshold } = await import("./licenseReminders.js");
  const row = (days, status = "active") => ({ status, expires_at: days === null ? null : inDays(days) });
  assert.equal(dueThreshold(row(45), NOW), null);
  assert.equal(dueThreshold(row(30), NOW), 30);
  assert.equal(dueThreshold(row(20), NOW), 30);
  assert.equal(dueThreshold(row(14), NOW), 14);
  assert.equal(dueThreshold(row(5), NOW), 7, "first seen at 5 days: the 7-day warning, not a burst of four");
  assert.equal(dueThreshold(row(1), NOW), 1);
  assert.equal(dueThreshold(row(-3), NOW), 0, "just expired");
  assert.equal(dueThreshold(row(-30), NOW), null, "lapsed long ago: never mass-mail it");
  assert.equal(dueThreshold(row(5, "revoked"), NOW), null);
  assert.equal(dueThreshold(row(null), NOW), null);
});

test("the reminder email names the license, the date and what happens next, and escapes what was typed", async () => {
  const { licenseReminderEmail } = await import("./license.email.js");
  const base = { name: "Maria", companyName: "ACME <Freight>", licenseNumber: "TRK01-ACME-2026-K7M4Q9XT2P", expires: "Mar 1, 2027", url: "https://x.test/admin/settings/license", reference: "LIC-000007", enforced: true };

  const soon = licenseReminderEmail({ ...base, daysLeft: 7, expired: false });
  assert.match(soon.subject, /expires in 7 days/);
  assert.match(soon.text, /TRK01-ACME-2026-K7M4Q9XT2P/);
  assert.match(soon.text, /no longer be able to sign in/);
  assert.ok(soon.html.includes("ACME &lt;Freight&gt;"), "company name is escaped in the HTML");
  assert.equal(soon.html.includes("<Freight>"), false);

  const tomorrow = licenseReminderEmail({ ...base, daysLeft: 1, expired: false });
  assert.match(tomorrow.subject, /expires tomorrow/);

  const gone = licenseReminderEmail({ ...base, daysLeft: 0, expired: true });
  assert.match(gone.subject, /has expired/);
  assert.match(gone.text, /can no longer sign in/);

  const soft = licenseReminderEmail({ ...base, daysLeft: 0, expired: true, enforced: false });
  assert.doesNotMatch(soft.text, /can no longer sign in/, "does not promise a lock-out the server is not enforcing");
});

test("the daily scheduler reports what it sent and holds back, and a failing sweep never throws or stops it", async () => {
  const { scheduleLicenseReminders } = await import("./licenseReminders.js");
  const lines = { log: [], error: [] };
  const log = { log: (m) => lines.log.push(m), error: (m) => lines.error.push(m) };
  const tick = () => new Promise((resolve) => setImmediate(resolve));

  const ok = scheduleLicenseReminders({
    log,
    intervalMs: 3_600_000,
    sweep: async () => ({
      sent: [{ company: "ACME", threshold: 7, recipients: 2 }, { company: "BETA", threshold: 0, recipients: 1 }],
      released: [{ company: "GAMMA", reason: "no administrator or company email to write to" }],
    }),
  });
  await tick();
  clearInterval(ok);
  assert.ok(lines.log.some((l) => /7d.*2 administrator.*ACME/.test(l)));
  assert.ok(lines.log.some((l) => /expired.*BETA/.test(l)));
  assert.ok(lines.error.some((l) => /GAMMA.*no administrator/.test(l)));

  const skipped = scheduleLicenseReminders({ log, intervalMs: 3_600_000, sweep: async () => ({ skipped: "Email is not set up", sent: [], released: [] }) });
  await tick();
  clearInterval(skipped);
  assert.ok(lines.log.some((l) => /Email is not set up/.test(l)));

  lines.error.length = 0;
  const broken = scheduleLicenseReminders({ log, intervalMs: 3_600_000, sweep: async () => { throw new Error("db gone"); } });
  await tick();
  clearInterval(broken);
  assert.ok(lines.error.some((l) => /db gone/.test(l)));
});
