/**
 * Turn on phone notifications for drivers: makes the key pair and puts it in .env.
 *
 *   npm run push:setup            writes the pair into the repo-root .env (once)
 *   npm run push:setup -- --print prints the three lines instead, for a host that
 *                                 takes environment variables rather than a file
 *
 * Safe to run again: an existing pair is left alone. Restart the API afterwards.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import webpush from "web-push";
import { valueOf, withPushKeys } from "../src/shared/pushKeys.js";

const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".env");
const keys = webpush.generateVAPIDKeys();

if (process.argv.includes("--print")) {
  console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
  console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
  console.log("VAPID_SUBJECT=mailto:support@example.com");
  process.exit(0);
}

const current = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
const { text, changed } = withPushKeys(current, { publicKey: keys.publicKey, privateKey: keys.privateKey });

if (!changed) {
  console.log("Phone notifications are already set up: .env has a key pair. Nothing changed.");
  process.exit(0);
}
fs.writeFileSync(envPath, text);
console.log(`Phone notifications set up. A key pair was written to ${envPath}.`);
if (valueOf(text, "VAPID_SUBJECT") === "mailto:support@example.com") {
  console.log("Set VAPID_SUBJECT in .env to a real contact (mailto:you@company.com) before going live.");
}
console.log("Restart the API so it picks the keys up. Do not change the pair later: phones registered under it would stop receiving notices.");
