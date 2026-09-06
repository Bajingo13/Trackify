/**
 * What this device can actually do, given how the app was reached.
 *
 * Several browser features are gated on a "secure context": HTTPS, or
 * localhost. Opened from a phone over the local network — http://192.168.x.x
 * — the origin is not secure, and the browser silently withholds:
 *
 *   • geolocation      → "Share my location" can never get a fix
 *   • service workers  → the app cannot be installed or opened offline
 *
 * Nothing throws. The features simply never work, which is worse: the driver
 * taps the toggle and nothing happens. This module names the limitation so the
 * app can say so out loud instead of failing quietly.
 *
 * The offline outbox is deliberately not in this list — IndexedDB works on any
 * origin, so work filed without signal is still saved and replayed either way.
 */

export const isSecure = () =>
  typeof window !== "undefined" && window.isSecureContext === true;

export const canShareLocation = () =>
  isSecure() && typeof navigator !== "undefined" && "geolocation" in navigator;

export const canInstall = () =>
  isSecure() && typeof navigator !== "undefined" && "serviceWorker" in navigator;

/** True when reached over plain HTTP from another device — the usual cause. */
export const isInsecureLan = () =>
  typeof window !== "undefined" &&
  !isSecure() &&
  window.location.protocol === "http:" &&
  !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);

/** One sentence a driver can act on, or null when everything is available. */
export function limitationNotice() {
  if (isSecure()) return null;
  if (isInsecureLan()) {
    return {
      title: "Limited on this connection",
      detail:
        "Location sharing and installing to your home screen need a secure (https) address. " +
        "Trips, delivery confirmation and expenses all still work.",
    };
  }
  return {
    title: "Limited on this browser",
    detail: "This browser is withholding location access. Trips, delivery confirmation and expenses still work.",
  };
}
