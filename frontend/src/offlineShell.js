/**
 * Registers the staff console's service worker (public/staff-sw.js).
 *
 * Only in a production build — in development Vite serves modules itself and a
 * worker would sit in front of hot reload — and never on /driver, which has its
 * own worker and scope. A service worker is refused on an insecure origin, so
 * over plain http from another device this quietly does nothing.
 */
export function shouldRegisterStaffWorker({ prod, nav, secure, pathname }) {
  if (!prod || !nav || !("serviceWorker" in nav) || !secure) return false;
  return !(pathname === "/driver" || pathname.startsWith("/driver/"));
}

export function registerStaffWorker({
  prod = import.meta.env.PROD,
  nav = typeof navigator === "undefined" ? undefined : navigator,
  secure = typeof window !== "undefined" && window.isSecureContext,
  pathname = typeof window === "undefined" ? "/" : window.location.pathname,
} = {}) {
  if (!shouldRegisterStaffWorker({ prod, nav, secure, pathname })) return false;
  nav.serviceWorker.register("/staff-sw.js", { scope: "/" }).catch(() => {
    /* unsupported or blocked — the console still works online */
  });
  return true;
}
