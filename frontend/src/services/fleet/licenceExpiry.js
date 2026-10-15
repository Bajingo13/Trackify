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
