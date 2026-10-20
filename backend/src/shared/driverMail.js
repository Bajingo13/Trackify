import { send } from "./mailer.js";

/**
 * Every email the system sends a driver goes out through here: their PIN, a
 * sign-in code for a phone, a notice that the PIN changed.
 *
 * One seam, so a test can keep each message instead of sending it. That
 * matters more than usual here: the local .env holds real SMTP settings, and
 * test fixtures carry addresses that look real.
 */
let mailer = send;

export const sendDriverMail = (message) => mailer(message);

/** Swap the sender in tests. Returns a function that puts the real one back. */
export function useDriverMailer(fn) {
  const before = mailer;
  mailer = fn || send;
  return () => { mailer = before; };
}

/** Where a driver opens the Driver App in a browser. */
export const driverAppUrl = () => `${(process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/+$/, "")}/driver`;
