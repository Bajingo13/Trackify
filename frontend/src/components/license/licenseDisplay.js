/**
 * How a license is said to a person. One vocabulary for the badge, the card,
 * the banner and the admin table, so the same state never reads two ways.
 */
export const LICENSE_STATES = {
  active: { label: "Active", hint: "The license is valid.", color: "var(--ok)", bg: "var(--ok-soft)" },
  expiring: { label: "Expiring soon", hint: "Valid, but ends within 30 days.", color: "var(--warn)", bg: "var(--warn-soft)" },
  expired: { label: "Expired", hint: "The end date has passed.", color: "var(--danger)", bg: "var(--danger-soft)" },
  revoked: { label: "Revoked", hint: "Switched off by an administrator.", color: "var(--danger)", bg: "var(--danger-soft)" },
  missing: { label: "No license", hint: "No license has been issued.", color: "var(--text-2)", bg: "var(--surface-sunk)" },
};

export function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** "12 days left · until Jun 15, 2027" / "Expired on …" / "Never expires". */
export function describeExpiry(license) {
  if (!license) return "";
  if (license.state === "revoked") return "Revoked";
  if (license.perpetual) return "Never expires";
  if (license.state === "expired") return `Expired on ${formatDate(license.expiresAt)}`;
  const n = license.daysRemaining;
  if (n === 0) return "Expires today";
  return `${n} day${n === 1 ? "" : "s"} left · until ${formatDate(license.expiresAt)}`;
}

/** Share of the license term already used, 0–100, or null when it has no end. */
export function termUsed(license, now = Date.now()) {
  if (!license?.expiresAt || !license?.issuedAt) return null;
  const start = new Date(license.issuedAt).getTime();
  const end = new Date(license.expiresAt).getTime();
  if (!(end > start)) return 100;
  return Math.min(100, Math.max(0, Math.round(((now - start) / (end - start)) * 100)));
}

export const TERM_OPTIONS = [
  { label: "6 months", months: 6 },
  { label: "1 year", months: 12 },
  { label: "2 years", months: 24 },
  { label: "3 years", months: 36 },
  { label: "No expiry", months: 0 },
];

const REMINDER_LEAD_DAYS = 30; // the earliest reminder the server sends

/**
 * The reminder history of a license as parts a screen can lay out — or null
 * when reminders do not apply (it never expires, or it was revoked on purpose).
 * `lastReminder` only ever describes the current term; a renewal clears it.
 *
 *   { kind: "sent",    label: "7-day warning", when: "Oct 2, 2026", to: "sent to 2 administrators" }
 *   { kind: "notDue",  label: "Not due yet" }    more than 30 days left, nothing to send
 *   { kind: "pending", label: "None sent yet" }  a reminder is due or past, none has gone out
 *
 * `to` is only present for System Administrators: the API leaves the recipient
 * count out for everyone else.
 */
export function reminderParts(license) {
  if (!license || license.perpetual || license.state === "revoked" || license.state === "missing") return null;
  const last = license.lastReminder;
  if (!last) {
    return license.state === "active" && license.daysRemaining > REMINDER_LEAD_DAYS
      ? { kind: "notDue", label: "Not due yet" }
      : { kind: "pending", label: "None sent yet" };
  }
  return {
    kind: "sent",
    label: last.thresholdDays === 0 ? "Expired notice" : `${last.thresholdDays}-day warning`,
    when: formatDate(last.sentAt),
    ...(last.recipients === undefined ? {} : { to: `sent to ${last.recipients} administrator${last.recipients === 1 ? "" : "s"}` }),
  };
}

/**
 * The same thing as one line, for places that have room for only one:
 *   "7-day warning · Oct 2, 2026"  /  "Expired notice · Oct 9, 2026 · sent to 2 administrators"
 *   "Not due yet"  /  "None sent yet"  /  null
 */
export function describeReminder(license) {
  const parts = reminderParts(license);
  if (!parts) return null;
  if (parts.kind !== "sent") return parts.label;
  return [parts.label, parts.when, parts.to].filter(Boolean).join(" · ");
}

/**
 * One plain sentence about where a license stands, for a person who does not
 * know what "revoked" means. The badge says the state; this says what it means.
 */
export function describeStatus(license) {
  if (!license) return "";
  if (license.state === "revoked") return "Switched off by an administrator.";
  if (license.state === "missing") return "This client has no license.";
  return describeExpiry(license);
}
