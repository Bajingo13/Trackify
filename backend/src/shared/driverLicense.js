/**
 * When a driver's licence is good until, and how worried to be about it.
 *
 * Several screens and jobs ask this question — the office driver list, the
 * Compliance feed and bell, Reports, the Driver App, the daily reminders, and
 * the scan that has just read a date off a card. They used to answer it
 * differently (30 days here, 60 there, UTC in one place and the server's own
 * clock in another), so the office and the driver could be looking at the same
 * licence and be told two different things. This is the one answer.
 *
 * The thresholds are the ones that matter operationally:
 *
 *   • an expired licence means the driver cannot lawfully be dispatched today
 *     (dispatch already refuses them)
 *   • 60 days is roughly how long an LTO renewal takes to come back if it goes
 *     wrong, so that is when it stops being paperwork and becomes a problem
 *
 * Days are counted in the Philippines, where the drivers are. A server running
 * in UTC would otherwise call a licence "expires today" for the eight hours of
 * the evening when it has already expired on the driver's calendar.
 */

export const LICENSE_WARNING_DAYS = 60;

/** The licence types a driver record may carry. The office and Driver App forms offer the same list. */
export const LICENSE_TYPES = ["Non-Professional", "Professional", "Student", "Conductor"];

/** What a driver's licence is taken to be until it says otherwise. */
export const DEFAULT_LICENSE_TYPE = "Professional";

/** The days-before at which a driver and the office are reminded, once each. */
export const LICENSE_REMINDER_THRESHOLDS = [60, 30, 14, 7, 1];

/** A licence that lapsed longer ago than this is not announced again as news. */
export const LICENSE_EXPIRED_NOTICE_DAYS = 14;

const DAY = 86_400_000;
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Today's calendar date in the Philippines, as YYYY-MM-DD. */
export const manilaToday = (now = new Date()) => new Date(now.getTime() + MANILA_OFFSET_MS).toISOString().slice(0, 10);

/** A DATE column (a 'YYYY-MM-DD' string) or a Date, reduced to its YYYY-MM-DD, or null. */
export function dateOnly(value) {
  if (!value) return null;
  const text = value instanceof Date ? (Number.isNaN(value.getTime()) ? "" : value.toISOString()) : String(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

const utcDay = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

/** Whole calendar days from today to the expiry. Negative once it has passed; null with no date. */
export function daysUntilExpiry(expiry, now = new Date()) {
  const day = dateOnly(expiry);
  if (!day) return null;
  return Math.round((utcDay(day) - utcDay(manilaToday(now))) / DAY);
}

/**
 * @returns {{ state: "none"|"valid"|"expiring"|"expired", daysLeft: number|null }}
 *
 * "Expires today" is still "expiring": the licence is good through its
 * expiry date, and dispatch (license_expiry >= today) agrees.
 */
export function expiryState(expiry, now = new Date()) {
  const daysLeft = daysUntilExpiry(expiry, now);
  if (daysLeft === null) return { state: "none", daysLeft: null };
  if (daysLeft < 0) return { state: "expired", daysLeft };
  if (daysLeft <= LICENSE_WARNING_DAYS) return { state: "expiring", daysLeft };
  return { state: "valid", daysLeft };
}

/**
 * Which reminder is due for a licence today: a threshold in days (60/30/14/7/1),
 * 0 for "has just expired", or null for none. Only the most urgent one that has
 * been crossed, so a licence first noticed at 5 days gets the 7-day notice and
 * not five in a burst.
 */
export function dueReminder(expiry, now = new Date()) {
  const daysLeft = daysUntilExpiry(expiry, now);
  if (daysLeft === null) return null;
  if (daysLeft < 0) return -daysLeft <= LICENSE_EXPIRED_NOTICE_DAYS ? 0 : null;
  const crossed = LICENSE_REMINDER_THRESHOLDS.filter((t) => daysLeft <= t);
  return crossed.length ? Math.min(...crossed) : null;
}

/** The sentence a person reads: "Expires in 12 days", "Expired 3 days ago". */
export function describeExpiry(daysLeft) {
  if (daysLeft === null || daysLeft === undefined) return "No expiry recorded";
  if (daysLeft < -1) return `Expired ${-daysLeft} days ago`;
  if (daysLeft === -1) return "Expired yesterday";
  if (daysLeft === 0) return "Expires today";
  if (daysLeft === 1) return "Expires tomorrow";
  return `Expires in ${daysLeft} days`;
}
