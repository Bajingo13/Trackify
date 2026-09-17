import { describe, test, expect, beforeEach, afterEach, vi } from "vitest"

/**
 * Where the driver is.
 *
 * This module shipped three separate faults in two days and had no test at
 * all. Every case below is one of them:
 *
 *   • the plugin was asked for through Capacitor.registerPlugin, which the
 *     injected bridge does not define — so the installed app recorded nothing
 *   • a rejected addWatcher escaped as an unhandled rejection, leaving a
 *     toggle that did nothing and said nothing
 *   • tracksInBackground answered "am I native" rather than "is the plugin
 *     reachable", so the screen promised a background trail it was not keeping
 */

const NATIVE = { Plugins: {}, isNativePlatform: () => true, getPlatform: () => "android" }

function stubGeolocation() {
  const watchPosition = vi.fn(() => 42)
  const clearWatch = vi.fn()
  Object.defineProperty(navigator, "geolocation", {
    value: { watchPosition, clearWatch },
    configurable: true,
    writable: true,
  })
  Object.defineProperty(window, "isSecureContext", { value: true, configurable: true })
  return { watchPosition, clearWatch }
}

/** Fresh module per test — the module keeps a watcher handle between calls. */
async function loadTracking() {
  vi.resetModules()
  return import("./tracking")
}

describe("driver location tracking", () => {
  let geo

  beforeEach(() => {
    geo = stubGeolocation()
  })

  afterEach(() => {
    delete globalThis.Capacitor
    vi.restoreAllMocks()
  })

  test("the plugin is taken from Capacitor.Plugins, which the bridge defines", async () => {
    // The injected native bridge exposes Plugins, getPlatform, isNativePlatform
    // and isPluginAvailable — and no registerPlugin, because that lives in
    // @capacitor/core's JS, which this bundle deliberately never imports.
    const addWatcher = vi.fn(async () => "watch-1")
    globalThis.Capacitor = { ...NATIVE, Plugins: { BackgroundGeolocation: { addWatcher } } }

    const { startTracking } = await loadTracking()
    const started = await startTracking(vi.fn(), vi.fn())

    expect(started).toBe(true)
    expect(addWatcher).toHaveBeenCalledTimes(1)
    expect(geo.watchPosition).not.toHaveBeenCalled()
  })

  test("registerPlugin is still honoured when @capacitor/core really is loaded", async () => {
    const addWatcher = vi.fn(async () => "watch-2")
    const registerPlugin = vi.fn(() => ({ addWatcher }))
    globalThis.Capacitor = { ...NATIVE, Plugins: {}, registerPlugin }

    const { startTracking } = await loadTracking()
    await startTracking(vi.fn(), vi.fn())

    expect(registerPlugin).toHaveBeenCalledWith("BackgroundGeolocation")
    expect(addWatcher).toHaveBeenCalled()
  })

  test("a missing plugin falls back to the foreground watcher instead of giving up", async () => {
    // Previously this returned false before reaching watchPosition, so the app
    // recorded no position of any kind. A trail that stops at the lock screen
    // is worth far more than no trail.
    globalThis.Capacitor = { ...NATIVE, Plugins: {} }
    const onError = vi.fn()

    const { startTracking } = await loadTracking()
    const started = await startTracking(vi.fn(), onError)

    expect(started).toBe(true)
    expect(geo.watchPosition).toHaveBeenCalled()

    const [message, meta] = onError.mock.calls[0]
    expect(message).toMatch(/only while this screen is open/i)
    expect(meta.fatal).toBe(false)
  })

  test("a rejected addWatcher is caught and reported, never left unhandled", async () => {
    const addWatcher = vi.fn(async () => { throw new Error("permission refused") })
    globalThis.Capacitor = { ...NATIVE, Plugins: { BackgroundGeolocation: { addWatcher } } }
    const onError = vi.fn()

    const { startTracking } = await loadTracking()
    const started = await startTracking(vi.fn(), onError)

    expect(started).toBe(true)
    const [message, meta] = onError.mock.calls[0]
    expect(message).toMatch(/permission refused/)
    expect(meta.fatal).toBe(false)
    expect(meta.canOpenSettings).toBe(true)
  })

  test("granting only “while using the app” still records a trail", async () => {
    // Android never offers "Allow all the time" in its own prompt, and the
    // plugin only ever asks for fine and coarse location. Treating that as
    // fatal threw away tracking the driver had just authorised.
    let report
    const addWatcher = vi.fn(async (_opts, cb) => { report = cb; return "watch-3" })
    globalThis.Capacitor = { ...NATIVE, Plugins: { BackgroundGeolocation: { addWatcher, removeWatcher: vi.fn() } } }
    const onError = vi.fn()

    const { startTracking } = await loadTracking()
    await startTracking(vi.fn(), onError)
    report(null, { code: "NOT_AUTHORIZED" })

    const [message, meta] = onError.mock.calls[0]
    expect(message).toMatch(/Allow all the time/)
    expect(meta.fatal).toBe(false)
    expect(meta.canOpenSettings).toBe(true)
  })

  test("a fix too vague to place the truck is dropped", async () => {
    let report
    const addWatcher = vi.fn(async (_opts, cb) => { report = cb; return "watch-4" })
    globalThis.Capacitor = { ...NATIVE, Plugins: { BackgroundGeolocation: { addWatcher } } }
    const onFix = vi.fn()

    const { startTracking } = await loadTracking()
    await startTracking(onFix, vi.fn())

    report({ latitude: 7.1, longitude: 125.6, accuracy: 400 }, null)
    expect(onFix).not.toHaveBeenCalled()

    report({ latitude: 7.1, longitude: 125.6, accuracy: 20, speed: 10, bearing: 90 }, null)
    expect(onFix).toHaveBeenCalledTimes(1)
    expect(onFix.mock.calls[0][0]).toMatchObject({ lat: 7.1, lng: 125.6, speedKph: 36, heading: 90 })
  })

  test("a GPS timeout does not switch sharing off for the rest of the run", async () => {
    globalThis.Capacitor = undefined
    const onError = vi.fn()

    const { startTracking } = await loadTracking()
    await startTracking(vi.fn(), onError)

    const onPositionError = geo.watchPosition.mock.calls[0][1]
    onPositionError({ code: 3, message: "Timeout expired" })

    expect(onError.mock.calls[0][1].fatal).toBe(false)
  })

  test("a refused browser permission is fatal, because retrying cannot fix it", async () => {
    globalThis.Capacitor = undefined
    const onError = vi.fn()

    const { startTracking } = await loadTracking()
    await startTracking(vi.fn(), onError)

    geo.watchPosition.mock.calls[0][1]({ code: 1, message: "User denied Geolocation" })
    expect(onError.mock.calls[0][1].fatal).toBe(true)
  })

  test("the background promise is only made when the plugin is actually reachable", async () => {
    const { tracksInBackground } = await loadTracking()

    globalThis.Capacitor = { ...NATIVE, Plugins: {} }
    expect(tracksInBackground()).toBe(false)

    globalThis.Capacitor = { ...NATIVE, Plugins: { BackgroundGeolocation: { addWatcher: vi.fn() } } }
    expect(tracksInBackground()).toBe(true)
  })

  test("the website never looks for a native plugin", async () => {
    globalThis.Capacitor = undefined

    const { startTracking, tracksInBackground } = await loadTracking()
    const started = await startTracking(vi.fn(), vi.fn())

    expect(tracksInBackground()).toBe(false)
    expect(started).toBe(true)
    expect(geo.watchPosition).toHaveBeenCalled()
  })
})
