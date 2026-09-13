import { isNativeApp } from "../platform"

/**
 * The things that make the app behave like an app.
 *
 * None of this is visual. It is the set of expectations an Android user has
 * without ever articulating them: the back button goes back, a confirmation
 * can be felt, the status bar belongs to the app, and the splash screen hands
 * over rather than flashing white.
 *
 * Every plugin is reached through globalThis.Capacitor rather than imported,
 * for the same reason as the tracking layer: they belong to the native shell,
 * not to the website, and the web build must not try to resolve them.
 */
function plugin(name) {
  const cap = globalThis.Capacitor
  if (!cap?.registerPlugin) return null
  try {
    return cap.registerPlugin(name)
  } catch {
    return null
  }
}

/**
 * Hardware back.
 *
 * Left alone, Android's back button closes the whole app from any screen —
 * the single loudest way a wrapped web page announces itself. `handler`
 * returns true if it consumed the press; when nothing does, the app closes,
 * which is what back means on a root screen.
 */
export function onHardwareBack(handler) {
  if (!isNativeApp()) return () => {}
  const App = plugin("App")
  if (!App) return () => {}

  let remove = null
  const listener = App.addListener("backButton", () => {
    if (handler()) return
    App.exitApp?.()
  })
  Promise.resolve(listener).then((l) => {
    remove = l?.remove?.bind(l)
  })

  return () => {
    remove?.()
    Promise.resolve(listener).then((l) => l?.remove?.())
  }
}

/**
 * A short tick on an action that changed something.
 *
 * Reserved for confirmations — a trip started, a delivery filed, a stop
 * reached. Buzzing on ordinary navigation is the fastest way to get a driver
 * to turn the phone to silent.
 */
export function tap(style = "medium") {
  if (!isNativeApp()) return
  plugin("Haptics")?.impact({ style: style.toUpperCase() })?.catch?.(() => {})
}

export function notifySuccess() {
  if (!isNativeApp()) return
  plugin("Haptics")?.notification({ type: "SUCCESS" })?.catch?.(() => {})
}

/**
 * Hand over from the splash screen, and give the status bar to the app.
 *
 * Without this the app opens on a white flash and then sits under a status bar
 * that belongs to nothing — light icons on a light ground, or the reverse.
 */
export function settleChrome() {
  if (!isNativeApp()) return

  const StatusBar = plugin("StatusBar")
  // The screens are light, so the icons on top of them have to be dark.
  StatusBar?.setStyle({ style: "LIGHT" })?.catch?.(() => {})
  StatusBar?.setBackgroundColor({ color: "#f1f5fb" })?.catch?.(() => {})

  // Hide only once the first screen has actually painted, otherwise the
  // handover is to a blank page and the flash happens anyway.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      plugin("SplashScreen")?.hide({ fadeOutDuration: 220 })?.catch?.(() => {})
    })
  })
}
