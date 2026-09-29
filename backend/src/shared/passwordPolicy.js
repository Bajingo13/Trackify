import { DEMO_PASSWORDS } from "./demoCredentials.js";

/**
 * What counts as an acceptable password, in one place.
 *
 * Every screen that sets a password — first activation, reset link, profile
 * change, administrator — goes through here, and the web forms show the same
 * rules as a live checklist (frontend/src/auth/passwordRules.js), so the two
 * must change together.
 *
 * The character-class rules (upper, lower, number, symbol) are the company's
 * policy. They sit on top of the length rule rather than replacing it: length
 * is still what makes a password hard to guess.
 */

export const MIN_PASSWORD_LENGTH = 10;

/* Unicode-aware, so "Ñ" counts as an uppercase letter and "ñ" as lowercase. */
const CHARACTER_RULES = [
  { test: /\p{Lu}/u, need: "an uppercase letter" },
  { test: /\p{Ll}/u, need: "a lowercase letter" },
  { test: /\p{Nd}/u, need: "a number" },
  { test: /[^\p{L}\p{N}\s]/u, need: "a special character such as ! @ # $ %" },
];

const listed = (items) =>
  items.length === 1 ? items[0] : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

/*
 * bcrypt hashes at most 72 bytes and silently ignores the rest. A 90-character
 * passphrase would therefore be stored as its first 72 bytes, and the person
 * typing it would believe they had a stronger password than they do — the
 * exact class of quiet lie this system has spent weeks removing. So it is
 * refused with an explanation rather than accepted and truncated.
 *
 * Bytes, not characters: one emoji is four of them.
 */
export const MAX_PASSWORD_BYTES = 72;

export function passwordProblem(password, { email = "" } = {}) {
  if (typeof password !== "string" || password.length === 0) {
    return "Enter a new password.";
  }
  /*
   * Checked before the length rule, not after. Every demonstration password is
   * shorter than the minimum, so a length check first would always answer
   * "too short" — true, but not the reason that matters. Somebody typing
   * "admin123" should be told it is the published demo password, or they will
   * simply pad it to "admin1234".
   */
  if (DEMO_PASSWORDS.some((demo) => demo.toLowerCase() === password.toLowerCase())) {
    return "That is one of the demonstration passwords published with this system. Choose another.";
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters. A short phrase you will remember beats a short puzzle you will not.`;
  }
  if (Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES) {
    return `That is longer than ${MAX_PASSWORD_BYTES} bytes, and only the first ${MAX_PASSWORD_BYTES} would actually be used. Please shorten it.`;
  }
  if (password.trim() !== password) {
    // A leading or trailing space survives the database and does not survive
    // being retyped from a note.
    return "Remove the space at the start or end.";
  }

  // All the missing kinds at once, so nobody fixes one and is then told the next.
  const missing = CHARACTER_RULES.filter((rule) => !rule.test.test(password)).map((rule) => rule.need);
  if (missing.length > 0) {
    return `Add ${listed(missing)}.`;
  }

  const local = String(email).split("@")[0]?.toLowerCase();
  if (local && local.length > 2 && password.toLowerCase().includes(local)) {
    return "Your password cannot contain your own email address.";
  }

  return null;
}
