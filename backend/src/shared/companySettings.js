import db from "../config/db.js";
import { isProduction } from "./environment.js";

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

/* ---------------------------------------------------------------- */
/* The emergency line                                               */
/* ---------------------------------------------------------------- */

/*
 * Read on its own, never by settingsFor(): that one runs inside trip creation
 * (generateTripNumber), and a database that has not had migration 058 yet must
 * still be able to number a trip.
 */

/**
 * Shown in place of a real number on a development or test server, labelled as
 * demo wherever it appears. The 0900 000 0000 block is not a working mobile
 * number. Never stored, and never served by production (see emergencyLineView).
 */
export const DEMO_EMERGENCY_LINE = "+63 900 000 0000";

/**
 * A phone number as people write them — "+63 917 123 4567", "(082) 224-1234",
 * "911". Returns the tidied number, "" for an empty value (the line is being
 * cleared), or null when it is not a phone number at all.
 *
 * Three digits at the least, so a short hotline like 911 is accepted; fifteen
 * at most, the international maximum (E.164). A + only at the front.
 */
export function normaliseEmergencyLine(value) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!text) return "";
  if (text.length > 20 || !/^\+?[0-9 ()-]+$/.test(text)) return null;
  const digits = text.replace(/\D/g, "").length;
  return digits >= 3 && digits <= 15 ? text : null;
}

/**
 * What a driver and an administrator are shown, given what is saved: the real
 * number; or, with none saved, the demo number on a non-production server and
 * nothing at all in production.
 */
export function emergencyLineView(saved, env = process.env) {
  if (saved) return { number: saved, isDemo: false };
  if (isProduction(env)) return { number: null, isDemo: false };
  return { number: DEMO_EMERGENCY_LINE, isDemo: true };
}

/** The number this company has saved, or null — including before migration 058 has run. */
export async function savedEmergencyLine(companyId, runner = db) {
  try {
    const [[row]] = await runner.execute(
      "SELECT emergency_line FROM company_settings WHERE company_id = ? LIMIT 1",
      [companyId]
    );
    // guarded on the way out too: a hand-edited row must not put a bad number on a Call button
    return (row && normaliseEmergencyLine(row.emergency_line)) || null;
  } catch (e) {
    if (e?.code === "ER_BAD_FIELD_ERROR") return null;
    throw e;
  }
}

export async function emergencyLineFor(companyId, { runner = db, env = process.env } = {}) {
  return emergencyLineView(await savedEmergencyLine(companyId, runner), env);
}

/* ---------------------------------------------------------------- */
/* Pre-trip inspection                                              */
/* ---------------------------------------------------------------- */

/**
 * Whether a trip may only start after a pre-trip inspection (fleet/
 * inspection.service.js). Off unless the company turned it on — and off on a
 * database without migration 060 — so trips start exactly as they always did
 * until somebody decides otherwise. Read on its own, like the emergency line,
 * never by settingsFor().
 */
export async function requiresPreTripInspection(companyId, runner = db) {
  try {
    const [rows] = await runner.execute(
      "SELECT require_pre_trip_inspection AS required FROM company_settings WHERE company_id = ? LIMIT 1",
      [companyId]
    );
    return Boolean(Number(Array.isArray(rows) ? rows[0]?.required : 0));
  } catch (e) {
    if (e?.code === "ER_BAD_FIELD_ERROR") return false;
    throw e;
  }
}
