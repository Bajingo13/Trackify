import nodemailer from "nodemailer";

/**
 * The system's only way of reaching a person outside the application.
 *
 * It had none until now, which is why there was no password reset: a locked
 * out user had to find an administrator. Everything here exists to serve that
 * one flow, so it is deliberately small.
 *
 * Two rules it follows, both learned the hard way in this project:
 *
 *   1. It never pretends. If SMTP is not configured, `send` says so in its
 *      result instead of returning quietly as though a message went out. A
 *      reset screen that says "check your email" when nothing was sent leaves
 *      somebody waiting for a message that will never arrive.
 *
 *   2. It never logs the contents. A reset link in a log file is a working
 *      key to an account sitting in plain text.
 */

const HOST = process.env.SMTP_HOST || "";
const PORT = Number(process.env.SMTP_PORT) || 587;
const USER = process.env.SMTP_USER || "";
const PASS = process.env.SMTP_PASSWORD || "";

/** The address people see, which may differ from the account that sends it. */
export const MAIL_FROM =
  process.env.MAIL_FROM || (USER ? `AstreaBlue Trackify <${USER}>` : "");

/** Where replies go, when they should reach a person rather than the robot. */
const REPLY_TO = process.env.MAIL_REPLY_TO || "";

export const isMailConfigured =() => Boolean(HOST && USER && PASS && MAIL_FROM);

/**
 * Why mail is not working, in words an operator can act on.
 *
 * Gmail is the expected provider, and the single most common failure is using
 * the account's own password instead of an app password — which fails with an
 * authentication error that does not explain itself.
 */
export function mailConfigurationProblem() {
  if (isMailConfigured()) return null;
  const missing = [
    !HOST && "SMTP_HOST",
    !USER && "SMTP_USER",
    !PASS && "SMTP_PASSWORD",
    !MAIL_FROM && "MAIL_FROM",
  ].filter(Boolean);
  return `Email is not set up: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set.`;
}

const FREE_MAIL = /^(gmail|googlemail|yahoo|ymail|outlook|hotmail|live|msn|aol|icloud|me|proton|protonmail|gmx|zoho)\.[a-z.]+$/i;
const addressOf = (value) => (/<([^>]+)>/.exec(value)?.[1] || value).trim().toLowerCase();
const domainOf = (address) => address.split("@")[1] || "";

/**
 * Why mail that sends fine may still land in spam — the failure `send` cannot
 * see. Returns plain sentences, empty when nothing looks wrong.
 *
 * Each is something receiving servers actually score: a company's mail from a
 * free mailbox (its own SPF/DKIM/DMARC never apply), a From that Gmail will
 * silently rewrite, and links to an address the recipient cannot open.
 */
export function mailDeliverabilityWarnings({ frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173" } = {}) {
  const warnings = [];
  const from = addressOf(MAIL_FROM);
  const fromDomain = domainOf(from);

  if (FREE_MAIL.test(fromDomain)) {
    warnings.push(
      `MAIL_FROM is a free ${fromDomain} address. Business mail from a personal mailbox is a common phishing ` +
      "pattern, and the company domain's SPF, DKIM and DMARC never apply to it. Send from an address on your " +
      "own domain (for Google Workspace: that user's app password, SMTP_HOST=smtp.gmail.com)."
    );
  }
  if (USER && from && from !== USER.toLowerCase() && /gmail\.com$|google/i.test(HOST)) {
    warnings.push(
      `MAIL_FROM (${from}) is not SMTP_USER (${USER}). Gmail rewrites From to the signed-in account unless ` +
      "the address is a verified \"Send mail as\" alias, so recipients may see a different sender than intended."
    );
  }
  try {
    const { protocol, hostname } = new URL(frontendUrl);
    if (/^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname)) {
      warnings.push(
        `FRONTEND_URL is ${frontendUrl}. Links in emails point there; recipients cannot open a local address, ` +
        "and filters treat links to private hosts as suspicious. Use the public https address."
      );
    } else if (protocol !== "https:") {
      warnings.push(`FRONTEND_URL is not https (${frontendUrl}). Plain-http links in email raise spam scores.`);
    }
  } catch {
    if (frontendUrl) warnings.push(`FRONTEND_URL (${frontendUrl}) is not a valid URL, so email links will be broken.`);
  }
  return warnings;
}

let transport = null;
function getTransport() {
  if (transport) return transport;
  transport = nodemailer.createTransport({
    host: HOST,
    port: PORT,
    // 465 is implicit TLS; 587 upgrades with STARTTLS, which nodemailer does
    // on its own when secure is false.
    secure: PORT === 465,
    auth: { user: USER, pass: PASS },
  });
  return transport;
}

/**
 * Send one message.
 *
 * Never throws. A failure to send is reported to the caller so it can decide
 * what to tell the person — and for a password reset, the answer is almost
 * always the same neutral sentence either way, so that a stranger cannot learn
 * from the response whether an account exists.
 */
/* `attachments` is optional — used to embed an image in the HTML by cid, so it
   shows even when the server's own address is unreachable (e.g. localhost). */
export async function send({ to, subject, text, html, attachments }) {
  const problem = mailConfigurationProblem();
  if (problem) return { sent: false, reason: problem };

  try {
    const info = await getTransport().sendMail({
      from: MAIL_FROM, to, subject, text, html,
      ...(REPLY_TO ? { replyTo: REPLY_TO } : {}),
      ...(attachments ? { attachments } : {}),
    });
    return { sent: true, messageId: info.messageId };
  } catch (error) {
    // The address is logged, never the body: the body holds the reset link.
    console.error(`[mail] could not send "${subject}" to ${to}: ${error.message}`);
    return { sent: false, reason: error.message };
  }
}

/** Prove the credentials work without sending anything to anybody. */
export async function verifyMail() {
  const problem = mailConfigurationProblem();
  if (problem) return { ok: false, reason: problem };
  try {
    await getTransport().verify();
    return { ok: true, host: HOST, from: MAIL_FROM };
  } catch (error) {
    const hint = /invalid login|username and password not accepted|535/i.test(error.message)
      ? " Gmail needs an app password here, not the account's own password."
      : "";
    return { ok: false, reason: `${error.message}.${hint}` };
  }
}

/** Swap the transport out in tests, so nothing is ever sent from a test run. */
export function __setTransport(fake) {
  transport = fake;
}
