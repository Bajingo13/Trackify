import crypto from "node:crypto";

/**
 * Client licenses.
 *
 * A license number reads  SYSTEM-CLIENT-YEAR-HASH,  e.g.  TRK01-ACME-2026-K7M4Q9XT2P
 *
 *   SYSTEM  which product it licenses (LICENSE_SYSTEM_CODE, default TRK01)
 *   CLIENT  the company's public code, so a number can be traced to its client
 *   YEAR    the year it was issued
 *   HASH    10 characters of cryptographic randomness — the part that cannot
 *           be guessed. The other three segments are readable by design, so
 *           the number is only ever trusted after it is looked up in the
 *           licenses table, never because it is well-formed.
 *
 * Nothing in this file touches the pool directly: callers pass the connection
 * (or pool) to use, so issuing a license can sit inside the same transaction
 * as the company it belongs to, and the migration can reuse it.
 */

export const SYSTEM_CODE = String(process.env.LICENSE_SYSTEM_CODE || "TRK01").trim().toUpperCase();
export const DEFAULT_TERM_MONTHS = 12;
export const EXPIRING_SOON_DAYS = 30;

// No 0/O or 1/I: a number read over the phone should not be ambiguous.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 symbols → 5 bits, no modulo bias
const HASH_LENGTH = 10;
const MAX_ATTEMPTS = 5;

export function randomSegment(length = HASH_LENGTH) {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) out += ALPHABET[bytes[i] & 31];
  return out;
}

export function generateLicenseNumber(companyCode, now = new Date(), systemCode = SYSTEM_CODE) {
  return `${systemCode}-${String(companyCode).toUpperCase()}-${now.getFullYear()}-${randomSegment()}`;
}

/** Whether a string has the shape of a license number. Shape only — see the note above. */
export function looksLikeLicenseNumber(value) {
  return /^[A-Z0-9]+-[A-Z0-9_-]+-\d{4}-[A-Z2-9]{10}$/.test(String(value || ""));
}

export function enforcementEnabled() {
  return String(process.env.LICENSE_ENFORCEMENT || "off").toLowerCase() === "on";
}

// Calendar months, clamped to the end of a shorter month: 31 Jan + 1 month is
// 28/29 Feb, not 3 March (which is what Date.setMonth alone would give).
export function addMonths(date, months) {
  const d = new Date(date);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d;
}

/**
 * Where a license stands right now.
 *   missing   the company has none
 *   revoked   switched off by an administrator
 *   expired   past its end date
 *   expiring  valid, but ends within EXPIRING_SOON_DAYS
 *   active    valid
 * `perpetual` licenses (no end date) never expire.
 */
export function licenseState(row, now = new Date()) {
  if (!row) return { state: "missing", valid: false, daysRemaining: null };
  if (row.status === "revoked") return { state: "revoked", valid: false, daysRemaining: null };
  if (!row.expires_at) return { state: "active", valid: true, daysRemaining: null };

  const msLeft = new Date(row.expires_at).getTime() - now.getTime();
  const daysRemaining = Math.ceil(msLeft / 86_400_000);
  if (msLeft <= 0) return { state: "expired", valid: false, daysRemaining: 0 };
  return {
    state: daysRemaining <= EXPIRING_SOON_DAYS ? "expiring" : "active",
    valid: true,
    daysRemaining,
  };
}

const MESSAGES = {
  missing: "This client has no license. Contact your administrator.",
  revoked: "This license has been revoked. Contact your administrator.",
  expired: "This license has expired. Contact your administrator to renew it.",
};
export const licenseMessage = (state) => MESSAGES[state] || null;

/**
 * The most recent expiry reminder sent for each license — for the CURRENT end
 * date only. Renewing moves the end date and starts a new cycle of reminders,
 * so a warning sent before the renewal is not "the last reminder" of the new
 * term and must not be shown as one. Returns Map<licenseId, reminder row>.
 */
export async function latestReminders(runner, licenseIds) {
  const ids = [...new Set(licenseIds.map(Number))].filter(Number.isInteger);
  const found = new Map();
  if (!ids.length) return found;
  const [rows] = await runner.execute(
    `SELECT r.license_id, r.threshold_days, r.recipients, r.sent_at
       FROM license_reminders r
       JOIN licenses l ON l.license_id = r.license_id AND r.expires_at <=> l.expires_at
      WHERE r.license_id IN (${ids.map(() => "?").join(", ")})
      ORDER BY r.sent_at DESC, r.reminder_id DESC`,
    ids
  );
  for (const row of rows) if (!found.has(row.license_id)) found.set(row.license_id, row);
  return found;
}

/**
 * The row as the API and the screens see it.
 * `reminder` (a latestReminders row) adds the reminder history; `{ recipients }`
 * is only included when the caller is allowed to see how many people were
 * written to — a client sees that a warning was sent, not who else got it.
 */
export function serializeLicense(row, now = new Date(), reminder = undefined, { withRecipients = false } = {}) {
  if (!row) return { ...licenseState(null, now), licenseNumber: null, message: MESSAGES.missing };
  const state = licenseState(row, now);
  return {
    licenseId: row.license_id,
    companyId: row.company_id,
    companyName: row.company_name ?? undefined,
    companyCode: row.company_code ?? undefined,
    licenseNumber: row.license_number,
    systemCode: row.system_code,
    status: row.status,
    state: state.state,
    valid: state.valid,
    daysRemaining: state.daysRemaining,
    perpetual: !row.expires_at,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at ?? null,
    revokedReason: row.revoked_reason ?? null,
    message: MESSAGES[state.state] || null,
    ...(reminder === undefined ? {} : {
      lastReminder: reminder
        ? {
            thresholdDays: reminder.threshold_days,
            sentAt: reminder.sent_at,
            ...(withRecipients ? { recipients: reminder.recipients } : {}),
          }
        : null,
    }),
  };
}

const LICENSE_COLUMNS = `l.license_id, l.company_id, l.system_code, l.license_number, l.status,
  l.issued_at, l.expires_at, l.revoked_at, l.revoked_reason, l.revoked_by,
  c.company_name, c.company_code`;

export async function findLicense(runner, companyId, systemCode = SYSTEM_CODE) {
  const [rows] = await runner.execute(
    `SELECT ${LICENSE_COLUMNS}
       FROM licenses l JOIN companies c ON c.company_id = l.company_id
      WHERE l.company_id = ? AND l.system_code = ? LIMIT 1`,
    [companyId, systemCode]
  );
  return rows[0] ?? null;
}

export async function listLicenses(runner, systemCode = SYSTEM_CODE) {
  const [rows] = await runner.execute(
    `SELECT ${LICENSE_COLUMNS}
       FROM licenses l JOIN companies c ON c.company_id = l.company_id
      WHERE l.system_code = ?
      ORDER BY c.company_name ASC`,
    [systemCode]
  );
  return rows;
}

/**
 * Issue a license to a company.
 *
 * Uniqueness is the database's job, not a check-then-insert: two requests can
 * both see "no such number" and both insert. The UNIQUE key decides, and a
 * collision on the number itself simply draws a new hash. A collision on
 * (company, system) means the client already has one — that is not retried.
 *
 * `termMonths` of null/0 issues a perpetual license.
 */
export async function issueLicense(runner, { companyId, companyCode, issuedBy = null, termMonths = DEFAULT_TERM_MONTHS, now = new Date() }) {
  const expiresAt = termMonths ? addMonths(now, Number(termMonths)) : null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const licenseNumber = generateLicenseNumber(companyCode, now);
    try {
      // eslint-disable-next-line no-await-in-loop
      const [result] = await runner.execute(
        `INSERT INTO licenses (company_id, system_code, license_number, status, issued_at, expires_at, issued_by)
         VALUES (?, ?, ?, 'active', ?, ?, ?)`,
        [companyId, SYSTEM_CODE, licenseNumber, now, expiresAt, issuedBy]
      );
      return { licenseId: result.insertId, licenseNumber, expiresAt };
    } catch (error) {
      const onNumber = error.code === "ER_DUP_ENTRY" && String(error.message).includes("uq_license_number");
      if (!onNumber || attempt === MAX_ATTEMPTS) throw error;
    }
  }
  throw new Error("Could not generate a unique license number.");
}

/** New end date for a renewal: counted from the later of today and the current end. */
export function renewedExpiry(currentExpiresAt, termMonths = DEFAULT_TERM_MONTHS, now = new Date()) {
  const current = currentExpiresAt ? new Date(currentExpiresAt) : now;
  return addMonths(current > now ? current : now, Number(termMonths));
}

/**
 * The license state of each of several companies at once — for sign-in, which
 * has to decide from everything a person can reach, not from one company.
 * Returns Map<companyId, state>; a company with no license maps to "missing".
 */
export async function licenseStatesFor(runner, companyIds, systemCode = SYSTEM_CODE, now = new Date()) {
  const ids = [...new Set(companyIds.map(Number))];
  const states = new Map(ids.map((id) => [id, "missing"]));
  if (!ids.length) return states;
  const [rows] = await runner.execute(
    `SELECT company_id, status, expires_at FROM licenses
      WHERE system_code = ? AND company_id IN (${ids.map(() => "?").join(", ")})`,
    [systemCode, ...ids]
  );
  for (const row of rows) states.set(row.company_id, licenseState(row, now).state);
  return states;
}

/**
 * The one question every entry point asks: may this company operate right now?
 *
 * Staff requests, the Driver App, driver sign-in and the live-tracking socket
 * all call this, so the answer cannot differ between them. When enforcement is
 * off it always says yes — licenses are then tracked and shown, never blocking.
 * A database error is not caught here: a check that cannot be made fails the
 * request rather than quietly waving it through.
 */
export async function checkCompanyLicense(runner, companyId) {
  if (!enforcementEnabled()) return { valid: true, enforced: false, state: null, message: null };
  const { state, valid } = licenseState(await findLicense(runner, companyId));
  return { valid, enforced: true, state, message: valid ? null : MESSAGES[state] };
}

/** The 403 body every refusal uses. */
export const licenseRefusal = (check) => ({
  success: false,
  code: "LICENSE_INVALID",
  licenseState: check.state,
  message: check.message,
});
