import { isNativeApp } from "../platform"
import { driverPushKey, driverPushSubscribe, driverPushUnsubscribe } from "./driverApi"

/**
 * Notices on the driver's phone when the office replies or decides a pause, even
 * with the app closed. Web Push, through the same service worker that lets the
 * app open without signal.
 *
 * What it needs: a browser that has Push (Chrome, Edge, Firefox, Samsung
 * Internet; Safari only once the app is added to the home screen), a secure page,
 * and a server with keys set. Where any is missing the app simply does not offer
 * it. The Android app shell does not have Push in its web view, so it does not
 * offer it either: that needs the native route (Firebase), which is separate.
 */

export function pushSupported() {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window &&
    !isNativeApp()
  )
}

/** The key the server gives as a base64url string, as the browser wants it. */
export function urlBase64ToUint8Array(base64) {
  const padded = `${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`.replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(padded)
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

// The worker may not be ready yet (first visit); waiting for ever would leave "Checking…" on screen.
const registration = () =>
  Promise.race([
    navigator.serviceWorker.ready,
    new Promise((resolve) => setTimeout(() => resolve(null), 4000)),
  ])

/**
 * Where notifications stand on this phone:
 *   "unsupported"  this browser or app cannot do it (nothing is offered)
 *   "unavailable"  the server has no keys (nothing is offered)
 *   "denied"       the driver blocked it in the browser's settings
 *   "off" | "on"
 */
export async function pushState() {
  if (!pushSupported()) return "unsupported"
  try {
    const { enabled } = await driverPushKey()
    if (!enabled) return "unavailable"
  } catch {
    return "unavailable"
  }
  if (Notification.permission === "denied") return "denied"
  const reg = await registration()
  if (!reg) return "unsupported"
  const sub = await reg.pushManager.getSubscription()
  return sub && Notification.permission === "granted" ? "on" : "off"
}

/** Ask permission, subscribe this phone, tell the server. Returns the new state. */
export async function enablePush() {
  const permission = await Notification.requestPermission()
  if (permission !== "granted") return permission === "denied" ? "denied" : "off"
  const { publicKey } = await driverPushKey()
  const reg = await registration()
  if (!reg || !publicKey) throw new Error("Notifications are not ready on this phone yet. Try again in a moment.")
  const sub =
    (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }))
  await driverPushSubscribe(sub.toJSON())
  return "on"
}

/** Turn this phone off: forget it on the server first, then stop the subscription. */
export async function disablePush() {
  const reg = await registration()
  const sub = reg && (await reg.pushManager.getSubscription())
  if (sub) {
    await driverPushUnsubscribe(sub.endpoint).catch(() => {})
    await sub.unsubscribe()
  }
  return "off"
}
