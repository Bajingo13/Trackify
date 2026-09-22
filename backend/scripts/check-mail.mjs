/**
 * Is email actually working?
 *
 *   npm run mail:check                    -- prove the credentials connect
 *   npm run mail:check -- you@gmail.com   -- and send one real test message
 *
 * Worth having because the two ways this fails are both silent from inside the
 * application: credentials that do not authenticate, and mail that is accepted
 * by the server and then filed as spam. The first this catches. The second only
 * a real message to a real inbox can tell you, which is what the address
 * argument is for.
 */
import "../src/config/env.js";
import { verifyMail, send, MAIL_FROM, isMailConfigured, mailConfigurationProblem } from "../src/shared/mailer.js";

const to = process.argv[2];

if (!isMailConfigured()) {
  console.error(`\n  ${mailConfigurationProblem()}\n`);
  console.error("  Set these in .env, then run this again:\n");
  console.error("    SMTP_HOST=smtp.gmail.com");
  console.error("    SMTP_PORT=587");
  console.error("    SMTP_USER=the.account@yourdomain.com");
  console.error("    SMTP_PASSWORD=the 16-character app password, not the account password");
  console.error("    MAIL_FROM=AstreaBlue Trackify <the.account@yourdomain.com>\n");
  console.error("  A Gmail app password comes from Google Account → Security → 2-Step");
  console.error("  Verification → App passwords. The account must have 2-Step on, or that");
  console.error("  page does not exist.\n");
  process.exit(1);
}

console.log(`\n  Connecting as ${MAIL_FROM}…`);
const check = await verifyMail();

if (!check.ok) {
  console.error(`\n  FAILED — ${check.reason}\n`);
  process.exit(1);
}
console.log(`  OK — ${check.host} accepted the credentials.\n`);

if (!to) {
  console.log("  Pass an address to send a real test message:\n");
  console.log("    npm run mail:check -- you@example.com\n");
  process.exit(0);
}

console.log(`  Sending a test message to ${to}…`);
const result = await send({
  to,
  subject: "Trackify mail check",
  text:
    "This is a test message from AstreaBlue Trackify.\n\n" +
    "If you are reading it, password reset emails will reach this address. " +
    "Check whether it landed in the inbox or in spam — that matters as much as whether it sent.",
  html:
    "<p>This is a test message from <strong>AstreaBlue Trackify</strong>.</p>" +
    "<p>If you are reading it, password reset emails will reach this address. " +
    "Check whether it landed in the inbox or in spam — that matters as much as whether it sent.</p>",
});

if (!result.sent) {
  console.error(`\n  FAILED to send — ${result.reason}\n`);
  process.exit(1);
}

console.log(`  Sent (${result.messageId}).`);
console.log("  Now go and look: inbox or spam? Spam is a deliverability problem, not a bug.\n");
process.exit(0);
