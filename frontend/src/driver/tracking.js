import { isNativeApp } from "../platform"

/**
 * Where the driver is, however the app happens to be running.
 *
 * On the web this is `watchPosition`, which Android suspends and then kills
 * once the app is backgrounded — so the trail dies the moment a driver locks
 * the screen or opens anything else. In the native app it is a background
 * geolocation plugin running behind a foreground service, which is the only
 * mechanism Android permits for keeping location alive when the app is not in
 * front.
 *
 * Both call back with the same shape, so the trip screen does not care which
 * one it got.
 */

/* Reached through the runtime rather than imported.
 *
 * @capacitor/core is a dependency of the native shell, not of the website, and
 * importing it here would make the web build fail to resolve it — or, worse,
 * succeed and ship a native shim to a page that can never use it.
 *
 * The catch, and this cost us a release: the bridge Capacitor injects into its
 * webview is NOT @capacitor/core. It defines Capacitor.Plugins, getPlatform,
 * isNativePlatform and isPluginAvailable — and no registerPlugin, because that
 * lives in the core JS package this bundle deliberately does not import. Asking
 * the bridge for registerPlugin therefore came back empty on every real phone,
 * the app reported background tracking as unavailable, and no position was ever
 * recorded from the APK.
 *
 * Capacitor.Plugins is the registry the bridge actually populates, so that is
 * what is read first. registerPlugin is kept as a fallback for the case where
 * @capacitor/core is genuinely on the page.
 */
const PLUGIN = "BackgroundGeolocation"

function nativePlugin() {
  const cap = globalThis.Capacitor
  if (!cap) return null
  const fromBridge = cap.Plugins?.[PLUGIN]
  if (fromBridge) return fromBridge
  if (typeof cap.registerPlugin === "function") return cap.registerPlugin(PLUGIN)
  return null
}

/** Drop fixes so vague they would yank the trail across the map. */
const MAX_ACCURACY_M = 150

let handle = null

/**
 * @param onFix  ({lat, lng, speedKph, heading, accuracyMeters}) => void
 * @param onError (message) => void
 * @returns true if tracking started
 */
export async function startTracking(onFix, onError) {
  await stopTracking()

  const emit = (c) => {
    if (c.accuracy != null && c.accuracy > MAX_ACCURACY_M) return
    onFix({
      lat: c.latitude,
      lng: c.longitude,
      speedKph: c.speed != null ? Math.round(c.speed * 3.6) : null,
      heading:
        c.bearing != null && !Number.isNaN(c.bearing) ? Math.round(c.bearing) : null,
      accuracyMeters: c.accuracy != null ? Math.round(c.accuracy) : null,
    })
  }

  const BackgroundGeolocation = isNativeApp() ? nativePlugin() : null

  if (BackgroundGeolocation) {
    const id = await BackgroundGeolocation.addWatcher(
      {
        // Android requires a visible notification for a foreground service.
        // It is not decoration: it is what stops the system reclaiming the
        // process, and what tells the driver their position is being shared.
        backgroundTitle: "Trackify is recording this trip",
        backgroundMessage: "Your position is shared with dispatch until you stop the trip.",
        requestPermissions: true,
        // A stale fix would post the driver where they were an hour ago.
        stale: false,
        // Metres of movement before a new fix. Parked, this stops the radio
        // waking every few seconds and cooking the battery.
        distanceFilter: 40,
      },
      (location, error) => {
        if (error) {
          // The driver refused, or turned location off after granting it.
          onError?.(
            error.code === "NOT_AUTHORIZED"
              ? "Trackify needs location permission set to “Allow all the time” to keep the trail alive while you drive."
              : error.message || "Location stopped unexpectedly.",
          )
          return
        }
        if (location) emit(location)
      },
    )
    handle = { kind: "native", id }
    return true
  }

  // No background plugin. This is not fatal and must not be treated as such:
  // a trail that stops when the screen locks is worth far more than no trail,
  // so the foreground watcher below runs anyway and the driver is told plainly
  // what they are getting.
  if (isNativeApp()) {
    onError?.(
      "Background tracking is unavailable on this build — your position is shared only while this screen is open.",
    )
  }

  if (!("geolocation" in navigator) || !window.isSecureContext) {
    onError?.("This device can't share GPS location.")
    return false
  }

  const id = navigator.geolocation.watchPosition(
    (p) => {
      const { latitude, longitude, speed, heading, accuracy } = p.coords
      emit({ latitude, longitude, speed, bearing: heading, accuracy })
    },
    (e) => onError?.(e.message || "Couldn't get your location. Allow location access."),
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
  )
  handle = { kind: "web", id }
  return true
}

export async function stopTracking() {
  if (!handle) return
  const h = handle
  handle = null
  try {
    if (h.kind === "native") {
      await nativePlugin()?.removeWatcher({ id: h.id })
    } else {
      navigator.geolocation.clearWatch(h.id)
    }
  } catch {
    /* already gone — nothing to unwind */
  }
}

/**
 * True where tracking survives the app being backgrounded.
 *
 * Asks whether the plugin is actually reachable rather than merely whether we
 * are in the native app. Those came apart once already, and the screen uses
 * this to promise the driver their trail "keeps running in the background" —
 * a promise worth making only when it is true.
 */
export const tracksInBackground = () => isNativeApp() && nativePlugin() != null
