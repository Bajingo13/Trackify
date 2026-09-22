import { DEMO_PASSWORDS } from "./demoCredentials.js";

/**
 * What counts as an acceptable password, in one place.
 *
 * Deliberately short. A rule nobody can satisfy without writing the password
 * on a sticky note has made things worse, so this checks the few things that
 * are actually true failures rather than imposing a character-class puzzle.
 */

export const MIN_PASSWORD_LENGTH = 10;

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

  const local = String(email).split("@")[0]?.toLowerCase();
  if (local && local.length > 2 && password.toLowerCase().includes(local)) {
    return "Your password cannot contain your own email address.";
  }

  return null;
}
