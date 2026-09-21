import db from "../config/db.js";

/**
 * A company's own defaults, read by the code that obeys them.
 *
 * Kept out of the controller so the trip-number generator and the retention
 * sweep can read a setting without importing an HTTP handler — and so there is
 * one place that decides what a missing row means.
 *
 * A missing row is not an error. A company that has never opened the settings
 * screen gets the defaults, which are the values the system used before the
 * screen existed, so nothing changes underneath anybody who never asked for it
 * to.
 */

export const DEFAULTS = Object.freeze({
  tripPrefix: "TT",
  locationRetentionMonths: 12,
});

/* A prefix goes into a document number people read aloud and type into
 * spreadsheets, so it is letters and digits, and short. */
const PREFIX = /^[A-Z][A-Z0-9-]{0,9}$/;

/** Twelve is the policy; a year and a half is still defensible, a decade is not. */
export const MIN_RETENTION_MONTHS = 1;
export const MAX_RETENTION_MONTHS = 120;

export function normalisePrefix(value) {
  const prefix = String(value ?? "").trim().toUpperCase();
  return PREFIX.test(prefix) ? prefix : null;
}

export function normaliseRetention(value) {
  const months = Number(value);
  if (!Number.isInteger(months)) return null;
  if (months < MIN_RETENTION_MONTHS || months > MAX_RETENTION_MONTHS) return null;
  return months;
}

/** What this company has chosen, falling back to what the system always did. */
export async function settingsFor(companyId, runner = db) {
  const [[row]] = await runner.execute(
    `SELECT trip_prefix, location_retention_months
       FROM company_settings WHERE company_id = ? LIMIT 1`,
    [companyId]
  );
  if (!row) return { ...DEFAULTS };

  return {
    // Guarded on the way out as well as in. A row edited straight in the
    // database should not be able to put nonsense in front of every trip
    // number the company issues from then on.
    tripPrefix: normalisePrefix(row.trip_prefix) || DEFAULTS.tripPrefix,
    locationRetentionMonths:
      normaliseRetention(row.location_retention_months) || DEFAULTS.locationRetentionMonths,
  };
}
