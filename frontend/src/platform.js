/**
 * Is this the native app, or the website?
 *
 * The same driver source ships two ways: as part of the web app at /driver,
 * and wrapped by Capacitor into an installable Android/iOS app. A handful of
 * decisions differ between the two — where the API lives, whether to register
 * a service worker — and this is the single place that answers the question.
 *
 * Capacitor defines `window.Capacitor` inside its native webview and nowhere
 * else, so the web build always reports false without needing Capacitor
 * installed or imported. That matters: the website must not carry a native
 * dependency just to know it is not native.
 */
export function isNativeApp() {
  try {
    return Boolean(globalThis.Capacitor?.isNativePlatform?.());
  } catch {
    return false;
  }
}

/** "android" | "ios" | "web" */
export function platformName() {
  try {
    return globalThis.Capacitor?.getPlatform?.() || "web";
  } catch {
    return "web";
  }
}

/**
 * Stamps the platform onto <html> so CSS can tell the two apart.
 *
 * The driver app is one set of components, so a style change lands on the
 * website and the native app alike — which is the point. When you want them to
 * differ, hang the difference off these classes rather than forking the
 * component:
 *
 *   .driver-header        { padding: 12px }     // both
 *   .is-native .driver-header { padding-top: 28px }   // app only
 *   .is-web .driver-header    { border-radius: 0 }    // website only
 *
 * Also sets data-platform="android" | "ios" | "web" for anything that needs to
 * distinguish the two native platforms.
 */
export function markPlatform() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const native = isNativeApp();
  root.classList.add(native ? "is-native" : "is-web");
  root.dataset.platform = platformName();
}
