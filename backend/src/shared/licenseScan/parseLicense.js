/**
 * Reads what an OCR engine saw on a Philippine driver's licence.
 *
 * Pure: text in, fields out. No file, no engine, no database — so every layout
 * and every OCR mistake seen in the field can be pinned down as a test.
 *
 * OCR never returns a clean card. It confuses O with 0 and I with 1, drops a
 * hyphen, splits a label from its value, and sometimes gives the label row and
 * the value row in the wrong order. So this does not look for "the line after
 * 'Expiration Date'". It finds things that have the SHAPE of a licence number or
 * a date wherever they are, and uses the labels around them only to decide which
 * date is which.
 *
 * Every field comes back with a confidence. "high" means the text matched the
 * strict shape and a label agreed with it; "low" means it was a guess the person
 * should look at twice. Nothing here is ever treated as final — the screens
 * show the result next to the card and the person confirms it.
 *
 * Only what the Trackify driver record holds is returned: licence number, name,
 * type and expiry. The birth date, address and the rest are read only to avoid
 * mistaking them for something else, and are not returned or kept.
 */
import { manilaToday } from "../driverLicense.js";

/* A character that is a digit, or an OCR's usual mistake for one. */
const D = "[0-9OoQDIl|!iZSsB]";
const DIGIT_FIX = {
  O: "0", o: "0", Q: "0", D: "0",
  I: "1", l: "1", "|": "1", "!": "1", i: "1",
  Z: "2", S: "5", s: "5", B: "8",
};
const digits = (s) => String(s).replace(/./g, (c) => DIGIT_FIX[c] ?? c);
const realDigits = (s) => (String(s).match(/[0-9]/g) || []).length;

/* ------------------------------------------------------------------ */
/* Licence number                                                     */
/* ------------------------------------------------------------------ */

/*
 * N01-12-345678: a letter and two digits (the agency), two digits (the year it
 * was first issued), six digits (the serial). The hyphens are the first thing an
 * OCR loses, so they are optional — but without them, nearly every character
 * has to be a real digit before it is believed.
 *
 * The agency may arrive with a third character: engines like to read "N01" as
 * "NO01", pairing the letter with its look-alike. The extra one is dropped and
 * the reading is marked as a guess.
 */
const LICENSE_NO = new RegExp(
  `(?<![A-Za-z0-9])([A-Z])\\s?(${D}{2,3})\\s?([-–—_.~]?)\\s?(${D}{2})\\s?([-–—_.~]?)\\s?(${D}{6})(?![A-Za-z0-9])`,
  "g"
);

export function findLicenseNo(text) {
  let best = null;
  for (const m of String(text).matchAll(LICENSE_NO)) {
    const [, letter, rawAgency, sep1, year, sep2, serial] = m;
    const padded = rawAgency.length === 3;
    const agency = padded ? rawAgency.slice(1) : rawAgency;
    const real = realDigits(agency + year + serial);
    const hyphenated = Boolean(sep1 && sep2);
    // Without hyphens it has to be nearly all real digits, or ordinary
    // capitalised words made of O, I, S and B would pass for a licence number.
    if (real < (hyphenated ? 7 : 9)) continue;
    const value = `${letter}${digits(agency)}-${digits(year)}-${digits(serial)}`;
    const strict = hyphenated && real === 10 && !padded;
    if (!best || (strict && !best.strict)) best = { value, strict };
    if (strict) break;
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Dates                                                              */
/* ------------------------------------------------------------------ */

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const iso = (y, m, d) => {
  if (!(y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1)) return null;
  if (d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return null; // 30 February, 31 April
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

const SEP = "\\s?[\\/\\-.]\\s?";
const YMD = new RegExp(`(?<![0-9A-Za-z])(${D}{4})${SEP}(${D}{1,2})${SEP}(${D}{1,2})(?![0-9A-Za-z])`, "g");
const DMY = new RegExp(`(?<![0-9A-Za-z])(${D}{1,2})${SEP}(${D}{1,2})${SEP}(${D}{4})(?![0-9A-Za-z])`, "g");
const D_MON_Y = /(?<![0-9A-Za-z])(\d{1,2})\s*([A-Za-z]{3,9})\.?,?\s*(\d{4})(?![0-9A-Za-z])/g;
const MON_D_Y = /(?<![0-9A-Za-z])([A-Za-z]{3,9})\.?\s*(\d{1,2}),?\s*(\d{4})(?![0-9A-Za-z])/g;

const monthOf = (word) => MONTHS[String(word).slice(0, 3).toLowerCase()] || null;

/**
 * Every date in a line, in reading order, as { iso, at, ambiguous }.
 * ambiguous: 03/04/2027 could be either way round and the text cannot say.
 */
export function findDates(line) {
  const found = [];
  const taken = [];
  const free = (a, b) => !taken.some(([x, y]) => a < y && b > x);
  const add = (m, value, ambiguous = false) => {
    if (!value) return;
    const a = m.index;
    const b = m.index + m[0].length;
    if (!free(a, b)) return;
    taken.push([a, b]);
    found.push({ iso: value, at: a, ambiguous });
  };

  for (const m of line.matchAll(YMD)) {
    add(m, iso(Number(digits(m[1])), Number(digits(m[2])), Number(digits(m[3]))));
  }
  for (const m of line.matchAll(DMY)) {
    const a = Number(digits(m[1]));
    const b = Number(digits(m[2]));
    const y = Number(digits(m[3]));
    if (a > 12) add(m, iso(y, b, a)); // 25/03/2027 can only be day first
    else if (b > 12) add(m, iso(y, a, b)); // 03/25/2027 can only be month first
    else add(m, iso(y, a, b), a !== b); // 03/04/2027: unknowable. Month first, flagged.
  }
  for (const m of line.matchAll(D_MON_Y)) {
    const month = monthOf(m[2]);
    if (month) add(m, iso(Number(m[3]), month, Number(m[1])));
  }
  for (const m of line.matchAll(MON_D_Y)) {
    const month = monthOf(m[1]);
    if (month) add(m, iso(Number(m[3]), month, Number(m[2])));
  }
  return found.sort((x, y) => x.at - y.at);
}

/* What a label is asking for. Order in the line matters, so each keeps its position. */
const LABELS = [
  ["expiry", /exp[a-z]*\.?|valid\s*(?:until|thru|through|to)|until/gi],
  ["birth", /birth|\bdob\b/gi],
  ["issue", /issu[a-z]*/gi],
];

function labelsIn(line) {
  if (!line) return [];
  const out = [];
  for (const [kind, re] of LABELS) {
    for (const m of line.matchAll(re)) out.push({ kind, at: m.index });
  }
  return out.sort((a, b) => a.at - b.at).map((l) => l.kind);
}

/* ------------------------------------------------------------------ */
/* Names                                                              */
/* ------------------------------------------------------------------ */

const NOT_A_NAME =
  /REPUBLIC|PHILIPPINES|TRANSPORT|LICENSE|LICENCE|DRIVER|ADDRESS|NATIONALITY|CODES?|CONDITIONS?|BLOOD|EYES|WEIGHT|HEIGHT|AGENCY|EXPIRATION|SERIAL|BARANGAY|STREET|PROVINCE|CITY|DEPARTMENT|OFFICE/;

const cleanName = (s) =>
  String(s)
    .replace(/[^A-Za-zÑñ.,'\- ]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .trim();

/** DELA CRUZ → Dela Cruz; O'BRIEN → O'Brien; JR → Jr. */
export function titleCase(s) {
  return String(s)
    .toLowerCase()
    .replace(/(^|[\s\-'])([a-zñ])/g, (_, lead, ch) => lead + ch.toUpperCase())
    .replace(/\b(ii|iii|iv|vi|vii|viii)\b/gi, (r) => r.toUpperCase())
    .replace(/\bJr\b\.?/g, "Jr.")
    .replace(/\bSr\b\.?/g, "Sr.");
}

/* "LAST, FIRST MIDDLE": letters, one comma, something each side. */
const SURNAME_FIRST = /^[A-ZÑ][A-ZÑ.'\- ]{1,40},\s*[A-ZÑ][A-ZÑ.'\- ]{1,50}$/;

function splitName(line) {
  const cleaned = cleanName(line).toUpperCase();
  if (!SURNAME_FIRST.test(cleaned) || NOT_A_NAME.test(cleaned)) return null;
  const [last, given] = cleaned.split(",").map((p) => p.trim());
  if (!last || !given) return null;
  return { lastName: titleCase(last), firstName: titleCase(given) };
}

function findName(lines) {
  // "Last Name: DELA CRUZ   First Name: JUAN" on one line
  for (const line of lines) {
    const last = line.match(/last\s*name\s*[:\-]\s*([A-Za-zÑñ.' -]+?)(?=\s{2,}|\s+first\s*name|$)/i);
    const first = line.match(/first\s*name\s*[:\-]\s*([A-Za-zÑñ.' -]+?)(?=\s{2,}|\s+(?:middle|last)\s*name|$)/i);
    if (last && first && cleanName(last[1]) && cleanName(first[1])) {
      return { lastName: titleCase(cleanName(last[1])), firstName: titleCase(cleanName(first[1])), labelled: true };
    }
  }
  // The label row, then the name under it
  const at = lines.findIndex((l) => /last\s*name/i.test(l));
  if (at >= 0) {
    for (const line of lines.slice(at + 1, at + 4)) {
      const name = splitName(line);
      if (name) return { ...name, labelled: true };
    }
  }
  // No label survived: any line that is shaped like "SURNAME, GIVEN NAMES"
  for (const line of lines) {
    const name = splitName(line);
    if (name) return { ...name, labelled: false };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Type                                                               */
/* ------------------------------------------------------------------ */

/* Longest first: "NON-PROFESSIONAL" contains "PROFESSIONAL". */
const TYPES = [
  ["Non-Professional", /NON[\s\-_.]*PROF/i],
  ["Professional", /PROFESSIONAL|PROF\.?\s*DRIVER/i],
  ["Student", /\bSTUDENT\b/i],
  ["Conductor", /\bCONDUCTOR\b/i],
];

function findType(text) {
  for (const [label, re] of TYPES) if (re.test(text)) return label;
  return null;
}

/* ------------------------------------------------------------------ */
/* Putting it together                                                */
/* ------------------------------------------------------------------ */

const EVIDENCE = [/LAND\s*TRANSPORT/i, /DRIVER/i, /LICEN[SC]E/i, /PHILIPPINES|REPUBLIC/i, /\bLTO\b/i, /EXPIR/i];

/** A licence outside this window is not one we would believe, however it was read. */
function plausibleExpiry(value, now) {
  const year = Number(value.slice(0, 4));
  const y = now.getUTCFullYear();
  return year >= y - 15 && year <= y + 20;
}

/**
 * @param {string} text  what the OCR engine returned
 * @param {{ now?: Date }} [options]
 */
export function parseLicenseText(text, { now = new Date() } = {}) {
  const raw = String(text || "");
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const fields = { licenseNo: null, firstName: null, lastName: null, licenseType: null, licenseExpiry: null };
  const confidence = {};

  /* licence number */
  const no = findLicenseNo(raw);
  if (no) {
    fields.licenseNo = no.value;
    confidence.licenseNo = no.strict ? "high" : "low";
  }

  /* dates: decide which is which from the labels around them */
  const dated = [];
  lines.forEach((line, i) => {
    const dates = findDates(line);
    if (!dates.length) return;
    let labels = labelsIn(line);
    if (!labels.length) labels = labelsIn(lines[i - 1]);
    dates.forEach((d, n) => {
      let kind = null;
      if (labels.length === dates.length) kind = labels[n];
      else if (dates.length === 1 && new Set(labels).size === 1) kind = labels[0];
      dated.push({ ...d, kind });
    });
  });

  let expiry = dated.find((d) => d.kind === "expiry" && plausibleExpiry(d.iso, now));
  let expiryLabelled = Boolean(expiry);
  if (!expiry) {
    // No usable label: the latest plausible date that is not the birth or issue date.
    const candidates = dated
      .filter((d) => !d.kind && plausibleExpiry(d.iso, now))
      .sort((a, b) => (a.iso < b.iso ? 1 : -1));
    expiry = candidates[0];
    expiryLabelled = false;
  }
  if (expiry) {
    fields.licenseExpiry = expiry.iso;
    confidence.licenseExpiry = expiryLabelled && !expiry.ambiguous ? "high" : "low";
  }

  /* name */
  const name = findName(lines);
  if (name) {
    fields.firstName = name.firstName;
    fields.lastName = name.lastName;
    confidence.firstName = confidence.lastName = name.labelled ? "high" : "low";
  }

  /* type: stated outright, or not at all. A guess here would classify a driver. */
  const type = findType(raw);
  if (type) {
    fields.licenseType = type;
    confidence.licenseType = "high";
  }

  const evidence = EVIDENCE.filter((re) => re.test(raw)).length;
  const found = Object.values(fields).filter(Boolean).length;

  return {
    // Something that is plainly a licence, or at least yielded its key fields.
    recognised: evidence >= 2 || Boolean(fields.licenseNo && fields.licenseExpiry),
    fields,
    confidence,
    found,
    expired: fields.licenseExpiry ? fields.licenseExpiry < manilaToday(now) : null,
  };
}
