import { isNativeApp } from "../platform"

const SETTING_KEY = "trackify-driver-arrival-notifications"
const LAST_TRIP_KEY = "trackify-driver-arrival-notification:last-trip"

function arrivalPlugin() {
  if (!isNativeApp()) return null
  const cap = globalThis.Capacitor
  const bridged = cap?.Plugins?.ArrivalNotifications
  if (bridged) return bridged
  if (typeof cap?.registerPlugin !== "function") return null
  try {
    return cap.registerPlugin("ArrivalNotifications")
  } catch {
    return null
  }
}

export function arrivalNotificationsAvailable() {
  return Boolean(arrivalPlugin())
}

export function arrivalNotificationsEnabled() {
  try {
    return arrivalNotificationsAvailable() && localStorage.getItem(SETTING_KEY) === "on"
  } catch {
    return false
  }
}

export async function enableArrivalNotifications() {
  const plugin = arrivalPlugin()
  if (!plugin) throw new Error("Arrival notifications are not available on this device.")

  const result = await plugin.requestPermission()
  if (!result?.granted) {
    throw new Error("Notifications are blocked. Allow them in your phone settings, then try again.")
  }
  localStorage.setItem(SETTING_KEY, "on")
  return true
}

export function disableArrivalNotifications() {
  try { localStorage.removeItem(SETTING_KEY) } catch { /* storage unavailable */ }
  return false
}

/**
 * Show the phone-level alert only while the app is behind another screen or
 * locked. In the foreground the existing arrival banner, haptic and delivery
 * sheet are clearer and a second system notification would only be noise.
 */
export async function showArrivalNotification({ tripId, destination }) {
  if (!arrivalNotificationsEnabled()) return false
  if (typeof document !== "undefined" && document.visibilityState === "visible") return false

  try {
    if (localStorage.getItem(LAST_TRIP_KEY) === String(tripId)) return false
  } catch { /* a blocked store must not block the notification */ }

  const plugin = arrivalPlugin()
  if (!plugin) return false
  try {
    const result = await plugin.show({
      tripId: Number(tripId),
      title: "You’ve arrived",
      body: destination ? `You’re near ${destination}. Open Trackify to complete the delivery.` : "Open Trackify to complete the delivery.",
    })
    const shown = Boolean(result?.shown)
    if (shown) {
      try { localStorage.setItem(LAST_TRIP_KEY, String(tripId)) } catch { /* best effort */ }
    }
    return shown
  } catch {
    // The in-app arrival flow must never depend on an optional notification.
    return false
  }
}

export const arrivalNotificationSettingKey = SETTING_KEY
