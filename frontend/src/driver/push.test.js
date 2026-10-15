import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ key: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn(), native: false }))
vi.mock("./driverApi", () => ({
  driverPushKey: (...a) => state.key(...a),
  driverPushSubscribe: (...a) => state.subscribe(...a),
  driverPushUnsubscribe: (...a) => state.unsubscribe(...a),
}))
vi.mock("../platform", () => ({ isNativeApp: () => state.native }))

import { disablePush, enablePush, pushState, pushSupported, urlBase64ToUint8Array } from "./push"

/** A browser that can do Push, with a worker whose subscription we control. */
function browser({ permission = "default", subscription = null, request = "granted" } = {}) {
  const sub = subscription && {
    endpoint: subscription.endpoint,
    toJSON: () => ({ endpoint: subscription.endpoint, keys: { p256dh: "k", auth: "a" } }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  }
  const pushManager = {
    getSubscription: vi.fn().mockResolvedValue(sub),
    subscribe: vi.fn().mockResolvedValue({ endpoint: "https://push.example/new", toJSON: () => ({ endpoint: "https://push.example/new", keys: { p256dh: "k", auth: "a" } }) }),
  }
  Object.defineProperty(window, "isSecureContext", { value: true, configurable: true })
  Object.defineProperty(window, "PushManager", { value: function PushManager() {}, configurable: true })
  window.Notification = { permission, requestPermission: vi.fn().mockResolvedValue(request) }
  Object.defineProperty(navigator, "serviceWorker", { value: { ready: Promise.resolve({ pushManager }) }, configurable: true })
  return { pushManager, sub }
}

describe("phone notifications in the browser", () => {
  beforeEach(() => {
    state.native = false
    state.key.mockReset().mockResolvedValue({ enabled: true, publicKey: "BAQAB-_w" })
    state.subscribe.mockReset().mockResolvedValue({})
    state.unsubscribe.mockReset().mockResolvedValue({})
  })
  afterEach(() => {
    delete window.PushManager
    delete window.Notification
    delete navigator.serviceWorker
  })

  it("turns the server's base64url key into the bytes a browser wants", () => {
    expect(Array.from(urlBase64ToUint8Array("BAQAB-_w"))).toEqual([4, 4, 0, 7, 239, 240])
  })

  it("is not offered in the Android app shell, nor where a browser has no Push", () => {
    browser()
    expect(pushSupported()).toBe(true)
    state.native = true
    expect(pushSupported()).toBe(false)
    state.native = false
    delete window.PushManager
    expect(pushSupported()).toBe(false)
  })

  it("reads where things stand: unsupported, no server keys, blocked, off, on", async () => {
    delete window.PushManager
    expect(await pushState()).toBe("unsupported")

    browser()
    state.key.mockResolvedValue({ enabled: false, publicKey: null })
    expect(await pushState()).toBe("unavailable")
    state.key.mockRejectedValue(new Error("offline"))
    expect(await pushState()).toBe("unavailable")

    state.key.mockResolvedValue({ enabled: true, publicKey: "BAQAB-_w" })
    browser({ permission: "denied" })
    expect(await pushState()).toBe("denied")
    browser({ permission: "granted", subscription: null })
    expect(await pushState()).toBe("off")
    browser({ permission: "granted", subscription: { endpoint: "https://push.example/1" } })
    expect(await pushState()).toBe("on")
  })

  it("asks permission, subscribes this phone with the server's key, and tells the server", async () => {
    const { pushManager } = browser()
    expect(await enablePush()).toBe("on")
    expect(window.Notification.requestPermission).toHaveBeenCalled()
    const options = pushManager.subscribe.mock.calls[0][0]
    expect(options.userVisibleOnly).toBe(true)
    expect(Array.from(options.applicationServerKey)).toEqual([4, 4, 0, 7, 239, 240])
    expect(state.subscribe).toHaveBeenCalledWith({ endpoint: "https://push.example/new", keys: { p256dh: "k", auth: "a" } })
  })

  it("does not subscribe or tell the server when the driver says no", async () => {
    const { pushManager } = browser({ request: "denied" })
    expect(await enablePush()).toBe("denied")
    browser({ request: "default" })
    expect(await enablePush()).toBe("off")
    expect(pushManager.subscribe).not.toHaveBeenCalled()
    expect(state.subscribe).not.toHaveBeenCalled()
  })

  it("turns off by forgetting the phone on the server and ending the subscription", async () => {
    const { sub } = browser({ permission: "granted", subscription: { endpoint: "https://push.example/1" } })
    expect(await disablePush()).toBe("off")
    expect(state.unsubscribe).toHaveBeenCalledWith("https://push.example/1")
    expect(sub.unsubscribe).toHaveBeenCalled()
  })
})
