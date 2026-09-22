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

export const isMailConfigured = () => Boolean(HOST && USER && PASS && MAIL_FROM);

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
export async function send({ to, subject, text, html }) {
  const problem = mailConfigurationProblem();
  if (problem) return { sent: false, reason: problem };

  try {
    const info = await getTransport().sendMail({ from: MAIL_FROM, to, subject, text, html });
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
