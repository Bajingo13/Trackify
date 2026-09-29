/**
 * The password rules as the forms show them, live, while somebody types.
 *
 * The server is the authority (backend/src/shared/passwordPolicy.js) and
 * refuses anything that breaks them; this copy only lets a form say what is
 * missing before a round trip. The two must change together.
 */

export const MIN_PASSWORD_LENGTH = 10;

export const PASSWORD_RULES = [
  { id: "length", label: `${MIN_PASSWORD_LENGTH}+ characters`, test: (pw) => pw.length >= MIN_PASSWORD_LENGTH },
  { id: "upper", label: "Uppercase letter", test: (pw) => /\p{Lu}/u.test(pw) },
  { id: "lower", label: "Lowercase letter", test: (pw) => /\p{Ll}/u.test(pw) },
  { id: "number", label: "Number", test: (pw) => /\p{Nd}/u.test(pw) },
  { id: "special", label: "Special character", test: (pw) => /[^\p{L}\p{N}\s]/u.test(pw) },
];

/** Each rule with whether `password` meets it. */
export function checkPassword(password = "") {
  return PASSWORD_RULES.map((rule) => ({ ...rule, met: rule.test(password) }));
}

export function meetsPasswordRules(password = "") {
  return PASSWORD_RULES.every((rule) => rule.test(password));
}
