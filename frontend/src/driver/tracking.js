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
 *
 * Problems are reported through onError as (message, { fatal, canOpenSettings }).
 * The distinction matters: a GPS timeout under a flyover is not a reason to
 * switch location sharing off for the rest of the run, and treating every
 * message as fatal is how a driver ends up with a toggle that flicks itself
 * back off with no explanation.
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
 * the bridge for registerPlugin therefore came back empty on every real phone.
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

/**
 * Sends the driver to this app's permission screen.
 *
 * Android will not grant "Allow all the time" from an in-app prompt — the
 * system prompt only ever offers "While using the app", and background access
 * has to be chosen in Settings. The plugin itself only ever requests fine and
 * coarse location, so background access is never asked for at all. Telling a
 * driver to change it is therefore not enough; they have to be taken there.
 */
export async function openLocationSettings() {
  try {
    await nativePlugin()?.openSettings()
    return true
  } catch {
    return false
  }
}

/** Drop fixes so vague they would yank the trail across the map. */
const MAX_ACCURACY_M = 150

let handle = null

/**
 * @param onFix  ({lat, lng, speedKph, heading, accuracyMeters}) => void
 * @param onError (message, { fatal, canOpenSettings }) => void
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

  /**
   * The ordinary watcher. Dies when the app is backgrounded, which is exactly
   * why the plugin exists — but it is what stands between a driver and no
   * trail at all when the plugin cannot run.
   */
  const beginForeground = () => {
    if (!("geolocation" in navigator) || !window.isSecureContext) {
      onError?.("This device can't share GPS location.", { fatal: true })
      return false
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const { latitude, longitude, speed, heading, accuracy } = p.coords
        emit({ latitude, longitude, speed, bearing: heading, accuracy })
      },
      (e) => {
        // 1 = PERMISSION_DENIED, and only that one ends the session. A lost
        // fix or a timeout is ordinary on the road — under a flyover, inside a
        // warehouse — and watchPosition keeps trying on its own.
        const denied = e?.code === 1
        onError?.(
          denied
            ? "Location permission was refused. Allow location access to share your position."
            : e?.message || "Lost your location for a moment — still trying.",
          { fatal: denied, canOpenSettings: denied && isNativeApp() },
        )
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
    )
    handle = { kind: "web", id }
    return true
  }

  const BackgroundGeolocation = isNativeApp() ? nativePlugin() : null

  if (BackgroundGeolocation) {
    try {
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
            if (error.code === "NOT_AUTHORIZED") {
              // Background location was refused, or was never offered — the
              // plugin only ever asks for fine and coarse. Rather than leave
              // the driver with nothing, drop to the foreground watcher and
              // point them at the setting that would fix it properly.
              onError?.(
                "Location is set to “While using the app”, so the trail will stop when your screen locks. " +
                  "Set it to “Allow all the time” to keep recording while you drive.",
                { fatal: false, canOpenSettings: true },
              )
              stopTracking().then(beginForeground)
              return
            }
            onError?.(error.message || "Location stopped unexpectedly.", { fatal: true })
            return
          }
          if (location) emit(location)
        },
      )
      handle = { kind: "native", id }
      return true
    } catch (e) {
      // addWatcher itself refused — permission denied outright, or the
      // foreground service could not start. Previously this escaped as an
      // unhandled rejection and the toggle simply did nothing, which from the
      // driver's side is a switch that is broken and says nothing.
      onError?.(
        e?.message
          ? `Background tracking could not start: ${e.message}`
          : "Background tracking could not start. Check that location permission is set to “Allow all the time”.",
        { fatal: false, canOpenSettings: true },
      )
    }
  } else if (isNativeApp()) {
    onError?.(
      "Background tracking is unavailable on this build — your position is shared only while this screen is open.",
      { fatal: false },
    )
  }

  return beginForeground()
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
