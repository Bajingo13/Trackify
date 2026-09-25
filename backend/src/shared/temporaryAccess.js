import { isMailConfigured, send } from "./mailer.js";
import { temporaryAccessEmail } from "../modules/auth/auth.emails.js";

/**
 * Getting a temporary password to the person it belongs to.
 *
 * When this server can send email, the password goes straight to that person
 * and is left out of the API response, so it never passes through the
 * administrator's browser. When it cannot — mail not set up, or the send
 * fails — the password comes back in the response as before, because an
 * account nobody can sign in to is worse than one handed over in person. The
 * response says which happened, and why, so the screen never claims an email
 * went out when it did not.
 */

/*
 * The account already exists by the time this runs. If the send hung past the
 * browser's own 30-second timeout, the administrator would see an error, retry,
 * be told the email is already registered, and never see the password. So a
 * slow send gives up and falls back to the screen.
 */
const SEND_TIMEOUT_MS = 15_000;

let mail = { isMailConfigured, send };

/** Swap mail out in tests. Pass nothing to put the real one back. */
export function __setMail(fake) {
  mail = fake ?? { isMailConfigured, send };
}

function signInUrl() {
  const base = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/+$/, "");
  return `${base}/login`;
}

/**
 * Returns the `data` fields describing the handover:
 *   { delivery: "email" }                                       — sent; no password
 *   { delivery: "screen", temporaryPassword, deliveryProblem }  — show it
 */
export async function deliverTemporaryPassword({
  to, name, password, expiresAt, firstAccount = false, timeoutMs = SEND_TIMEOUT_MS,
}) {
  if (!mail.isMailConfigured()) {
    return {
      delivery: "screen",
      temporaryPassword: password,
      deliveryProblem: "Email is not set up on this server, so it could not be sent.",
    };
  }

  const message = temporaryAccessEmail({
    name,
    password,
    expires: expiresAt.toLocaleString("en-PH", { timeZone: "Asia/Manila" }),
    signInUrl: signInUrl(),
    firstAccount,
  });

  let timer;
  const result = await Promise.race([
    mail.send({ to, ...message }),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve({ sent: false, reason: "timed out" }), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));

  if (result.sent) return { delivery: "email" };

  // The reason goes to the log, not the screen: it can hold server details.
  console.error(`[temporary-access] email to ${to} not sent: ${result.reason}`);
  return {
    delivery: "screen",
    temporaryPassword: password,
    deliveryProblem: "The email could not be sent.",
  };
}
