/**
 * Where the API lives, from the browser's point of view.
 *
 * VITE_API_URL is set to http://localhost:5000 for development, which is
 * correct on the machine running the servers and wrong everywhere else: opened
 * from a phone on the same wifi, "localhost" is the phone, so every request —
 * including sign-in — fails with nothing to explain it.
 *
 * So when the configured origin points at localhost but the page itself was
 * served from some other host, follow the page's host and keep the configured
 * port. A real deployment, where VITE_API_URL names an actual API host, is
 * untouched.
 */
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\]|::1)$/;

function resolve() {
  const configured = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");

  if (typeof window === "undefined" || !window.location) {
    return configured || "http://localhost:5000";
  }

  const pageHost = window.location.hostname;
  const pageIsLoopback = LOOPBACK.test(pageHost);

  if (configured) {
    try {
      const url = new URL(configured);
      if (LOOPBACK.test(url.hostname) && !pageIsLoopback) {
        // Reached from somewhere else — a phone on the wifi, or a tunnel.
        // Use this same origin and let the dev server proxy /api onward: a
        // tunnel only exposes one port, so guessing the API port would work
        // on the LAN and fail through a tunnel.
        return "";
      }
      return configured;
    } catch {
      /* malformed value — fall through to the derived default */
    }
  }

  // Production serves the SPA and API from the same Express service. An empty
  // origin makes fetch and WebSocket clients follow the page's HTTPS origin.
  if (import.meta.env.PROD) return "";

  return `${window.location.protocol}//${pageHost}:5000`;
}

export const API_ORIGIN = resolve();
