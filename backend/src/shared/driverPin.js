import crypto from "node:crypto";
import { isDemoPin } from "./demoCredentials.js";

/**
 * Driver App PINs: made by the system for a new driver, and chosen by the
 * driver afterwards (Profile → Change PIN).
 *
 * A PIN is four to six digits, so the space is small however it is picked;
 * what makes it worth anything is the one-trusted-phone rule and the sign-in
 * throttle around it. The checks here only stop the PINs everybody tries
 * first.
 */

export const PIN_FORMAT = /^\d{4,6}$/;

/** Six random digits, never one that would be refused as weak. */
export function generatePin() {
  for (;;) {
    const pin = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    if (!weakPinProblem(pin)) return pin;
  }
}

const allSame = (pin) => /^(\d)\1+$/.test(pin);
const runOf = (pin, step) => [...pin].every((d, i) => i === 0 || Number(d) === (Number(pin[i - 1]) + step + 10) % 10);

/** Why a PIN may not be used, or null. */
export function weakPinProblem(pin) {
  const text = String(pin ?? "").trim();
  if (!PIN_FORMAT.test(text)) return "Your PIN must be 4 to 6 digits.";
  if (isDemoPin(text)) return "That PIN is too easy to guess. Choose another.";
  if (allSame(text)) return "Don't use the same digit over and over. Choose another PIN.";
  if (runOf(text, 1) || runOf(text, -1)) return "Don't use digits in order, like 1234. Choose another PIN.";
  return null;
}
