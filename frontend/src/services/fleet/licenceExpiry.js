/**
 * Where a driver's licence stands, as the office screens word it.
 *
 * The driver list, the driver detail, the dispatch pickers and the dispatch
 * pre-check each used to answer this their own way — "within 30 days" in two of
 * them, a millisecond comparison in another that called a licence expired on the
 * day it expires. They now share this one, and it matches the server
 * (backend/src/shared/driverLicense.js), the Compliance feed and the Driver App:
 *
 *   • a licence is good THROUGH its expiry date — dispatch refuses a driver only
 *     once that date has passed
 *   • "expiring" is within 60 days, roughly how long an LTO renewal takes to come
 *     back if it goes wrong
 *
 * Days are whole calendar days on the viewer's calendar. The dates themselves
 * are plain 'YYYY-MM-DD' days, so no timezone can shift one.
 */

export const LICENCE_WARNING_DAYS = 60;

/**
 * A licence number as the server compares it: upper case, separators removed,
 * so "N01-12-345678" and "n01 12 345678" are one licence (licenceKey in
 * backend/src/shared/driverLicense.js).
 */
export const licenceKey = (licenseNo) => String(licenseNo ?? "").toUpperCase().replace(/[ \-./]/g, "");

const asDay = (value) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ""));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};

/** Whole days from today to the expiry; negative once passed; null with no usable date. */
export function licenceDaysLeft(expiry, now = new Date()) {
  const day = asDay(expiry);
  if (!day) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((day - today) / 86_400_000);
}

/**
 * @returns {{ state: "none"|"valid"|"expiring"|"expired", days: number|null,
 *             label: "Valid"|"Expiring Soon"|"Expired", text: string }}
 */
export function licenceExpiry(expiry, now = new Date()) {
  const days = licenceDaysLeft(expiry, now);
  if (days === null) return { state: "none", days, label: "Valid", text: "No expiry recorded" };
  if (days < 0) {
    return { state: "expired", days, label: "Expired", text: days === -1 ? "Expired yesterday" : `Expired ${-days} days ago` };
  }
  if (days <= LICENCE_WARNING_DAYS) {
    const text = days === 0 ? "Expires today" : days === 1 ? "Expires tomorrow" : `Expires in ${days} days`;
    return { state: "expiring", days, label: "Expiring Soon", text };
  }
  return { state: "valid", days, label: "Valid", text: `Valid for ${days} more days` };
}

/*
 * The range a typed expiry date must fall in, as the server checks it
 * (implausibleExpiry in backend/src/shared/driverLicense.js): at most eleven
 * years ahead, since a licence runs for at most ten, and no more than ten years
 * gone. 2099 for 2029 would otherwise silence every warning for that driver.
 */
const MAX_YEARS_AHEAD = 11;
const MAX_YEARS_PAST = 10;
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const shiftYears = (iso, years) => `${Number(iso.slice(0, 4)) + years}${iso.slice(4)}`;

/** { min, max } as YYYY-MM-DD, for a date input's min and max. */
export function licenceExpiryBounds(now = new Date()) {
  const today = isoDay(now);
  return { min: shiftYears(today, -MAX_YEARS_PAST), max: shiftYears(today, MAX_YEARS_AHEAD) };
}

/** Why a typed expiry cannot be right, or null. */
export function licenceExpiryProblem(expiry, now = new Date()) {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(expiry ?? ""));
  if (!m) return null;
  const { min, max } = licenceExpiryBounds(now);
  if (m[1] > max) return `A licence expiry after ${max} is not possible (licences run for at most ten years). Check the year.`;
  if (m[1] < min) return `A licence expiry before ${min} is not plausible. Check the year.`;
  return null;
}
