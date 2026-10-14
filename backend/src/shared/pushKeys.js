/**
 * Putting the phone-notification key pair into an .env file, without ever
 * replacing a pair that is already there.
 *
 * Changing the pair later silently stops notifications for every phone that
 * registered under the old one, so an existing pair is left exactly as it is.
 */

const KEYS = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"];

/** The value set for `name` in .env text, or "" if it is missing or empty. */
export function valueOf(text, name) {
  const match = String(text).match(new RegExp(`^${name}=(.*)$`, "m"));
  return match ? match[1].trim() : "";
}

/**
 * Returns { text, changed }. A pair is added when either key is missing or empty;
 * lines that exist but are empty (as in .env.example) are filled in place, others appended.
 */
export function withPushKeys(text, { publicKey, privateKey }, subject = "mailto:support@example.com") {
  const source = String(text);
  if (KEYS.every((k) => valueOf(source, k))) return { text: source, changed: false };

  let out = source;
  const set = (name, value) => {
    const line = new RegExp(`^${name}=.*$`, "m");
    out = line.test(out) ? out.replace(line, `${name}=${value}`) : `${out.replace(/\n*$/, "\n")}${name}=${value}\n`;
  };
  if (!/^# Phone notifications/m.test(out) && !/^VAPID_/m.test(out)) {
    out = `${out.replace(/\n*$/, "\n")}\n# Phone notifications for drivers (made by npm run push:setup)\n`;
  }
  set("VAPID_PUBLIC_KEY", publicKey);
  set("VAPID_PRIVATE_KEY", privateKey);
  if (!valueOf(out, "VAPID_SUBJECT")) set("VAPID_SUBJECT", subject);
  return { text: out, changed: true };
}
