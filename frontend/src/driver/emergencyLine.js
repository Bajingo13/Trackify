/**
 * The company's emergency line, kept on the phone.
 *
 * It comes with the driver's profile (GET /driver/me) and is saved here each
 * time that loads, so the Emergency screen can show it, and its Call button
 * can dial it, with no signal at all — which is when it is needed most.
 *
 * Kept per driver, so a phone handed to a driver from another company never
 * offers the first company's line. Storage that is full or blocked is not an
 * error: the screen then offers 911, as it does before anything has loaded.
 */

const KEY = "trackify-driver-emergency-line";
const keyFor = (driverId) => `${KEY}:${driverId}`;

/** Saves what the server said — including "none set" — for this driver. */
export function rememberEmergencyLine(driverId, line) {
  if (!driverId || !line || typeof line !== "object") return;
  try {
    localStorage.setItem(
      keyFor(driverId),
      JSON.stringify({ number: line.number || null, isDemo: Boolean(line.isDemo), savedAt: Date.now() })
    );
  } catch {
    /* full or blocked: the screen falls back to 911 */
  }
}

/** { number, isDemo, savedAt } as last loaded for this driver, or null if never. */
export function cachedEmergencyLine(driverId) {
  if (!driverId) return null;
  try {
    const raw = localStorage.getItem(keyFor(driverId));
    if (!raw) return null;
    const line = JSON.parse(raw);
    return line && typeof line === "object" ? line : null;
  } catch {
    return null;
  }
}

/**
 * A tel: link for a hotline. Unlike telHref (customer numbers, five digits at
 * least), a short number such as 911 has to dial too.
 */
export function dialHref(number) {
  const text = String(number ?? "").trim();
  const digits = text.replace(/\D/g, "");
  if (digits.length < 3 || digits.length > 15) return null;
  return `tel:${text.startsWith("+") ? "+" : ""}${digits}`;
}
