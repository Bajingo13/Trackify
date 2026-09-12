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
