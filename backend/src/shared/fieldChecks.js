/**
 * Field checks for text a person types into a form.
 *
 * These exist because a value the database refuses arrives back as HTTP 500.
 * A 500 tells the person filling in the form that the system is broken, when
 * what happened is that their entry was too long for the column — something
 * they could fix in a second if anybody told them. The limits here are the
 * column widths, so the answer comes from the validator rather than from
 * MySQL.
 *
 * Every function returns a message or null, so a caller reads as a list of
 * questions with one answer each.
 */

/*
 * Deliberately permissive. Addresses in the Philippines legitimately carry
 * plus-addressing, apostrophes and unusual domains, and a regex strict enough
 * to satisfy a standards document rejects real customers. This catches what is
 * plainly not an address — no @, no domain, spaces in the middle — and leaves
 * the rest to whether mail actually arrives.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** A phone as people write them here: digits, spaces, + ( ) - and nothing else. */
const PHONE = /^[0-9+()\-. ]{5,}$/;

export function textField(value, { label, max, required = false }) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return required ? `${label} is required.` : null;
  }
  const text = String(value).trim();
  if (text.length > max) {
    // The number is in the message because "too long" without a limit is a
    // guessing game, and the person is usually pasting from somewhere.
    return `${label} is too long — ${text.length} characters, and the most that fits is ${max}.`;
  }
  return null;
}

export function emailField(value, { label = "Email", max = 200, required = false } = {}) {
  const empty = value === undefined || value === null || String(value).trim() === "";
  if (empty) return required ? `${label} is required.` : null;

  const text = String(value).trim();
  if (text.length > max) return `${label} is too long — the most that fits is ${max} characters.`;
  if (!EMAIL.test(text)) return `${label} does not look like an email address.`;
  return null;
}

export function phoneField(value, { label = "Phone", max = 50 } = {}) {
  const empty = value === undefined || value === null || String(value).trim() === "";
  if (empty) return null;

  const text = String(value).trim();
  if (text.length > max) return `${label} is too long — the most that fits is ${max} characters.`;
  if (!PHONE.test(text)) return `${label} should be digits, and may include + ( ) - and spaces.`;
  return null;
}

/** The first thing wrong, or null. */
export function firstProblem(...checks) {
  for (const problem of checks) if (problem) return problem;
  return null;
}
