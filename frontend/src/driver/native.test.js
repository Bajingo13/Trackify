import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keepScreenOn, notifySuccess, onHardwareBack, tap } from "./native";

/*
 * The bridge Capacitor injects into its webview populates Capacitor.Plugins and
 * has no registerPlugin (see tracking.js). These stand in for that bridge.
 */
function bridge(plugins) {
  globalThis.Capacitor = { isNativePlatform: () => true, getPlatform: () => "android", Plugins: plugins };
}

describe("native plugins through the webview bridge", () => {
  afterEach(() => { delete globalThis.Capacitor; });

  it("finds Haptics in Capacitor.Plugins when there is no registerPlugin", () => {
    const impact = vi.fn().mockResolvedValue(undefined);
    const notification = vi.fn().mockResolvedValue(undefined);
    bridge({ Haptics: { impact, notification } });
    tap("light");
    notifySuccess();
    expect(impact).toHaveBeenCalledWith({ style: "LIGHT" });
    expect(notification).toHaveBeenCalledWith({ type: "SUCCESS" });
  });

  it("claims the hardware back button, so back does not close the app from any screen", () => {
    let pressed = null;
    const exitApp = vi.fn();
    bridge({ App: { addListener: (_event, fn) => { pressed = fn; return { remove: vi.fn() }; }, exitApp } });
    const handler = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);
    const off = onHardwareBack(handler);
    pressed();
    expect(exitApp).not.toHaveBeenCalled();
    pressed();
    expect(exitApp).toHaveBeenCalledTimes(1);
    off();
  });

  it("does nothing in a browser", () => {
    expect(() => { tap(); notifySuccess(); onHardwareBack(() => true)(); }).not.toThrow();
  });
});

describe("keeping the screen on", () => {
  let visibility = "visible";
  const flush = () => new Promise((r) => setTimeout(r, 0));

  function fakeWakeLock() {
    const locks = [];
    const request = vi.fn(async () => {
      const handlers = [];
      const lock = {
        release: vi.fn(async () => { handlers.forEach((h) => h()); }),
        addEventListener: (_event, h) => handlers.push(h),
        // what the browser does on its own when the app is hidden
        dropByBrowser: () => handlers.forEach((h) => h()),
      };
      locks.push(lock);
      return lock;
    });
    Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request } });
    return { request, locks };
  }

  function setVisibility(v) {
    visibility = v;
    document.dispatchEvent(new Event("visibilitychange"));
  }

  beforeEach(() => {
    visibility = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  });
  afterEach(() => {
    delete navigator.wakeLock;
    delete document.visibilityState;
  });

  it("asks for a screen wake lock, and releases it when told to", async () => {
    const { request, locks } = fakeWakeLock();
    const letSleep = keepScreenOn();
    await flush();
    expect(request).toHaveBeenCalledWith("screen");
    letSleep();
    expect(locks[0].release).toHaveBeenCalledTimes(1);
  });

  it("takes the lock again when the app comes back to the front", async () => {
    const { request, locks } = fakeWakeLock();
    const letSleep = keepScreenOn();
    await flush();

    locks[0].dropByBrowser();
    setVisibility("hidden");
    await flush();
    expect(request).toHaveBeenCalledTimes(1);

    setVisibility("visible");
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
    letSleep();
  });

  it("does not stack a second lock while one is held", async () => {
    const { request } = fakeWakeLock();
    const letSleep = keepScreenOn();
    await flush();
    setVisibility("visible");
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    letSleep();
  });

  it("lets go at once if the run ended before the phone answered", async () => {
    const { locks } = fakeWakeLock();
    const letSleep = keepScreenOn();
    letSleep();
    await flush();
    expect(locks[0].release).toHaveBeenCalledTimes(1);
  });

  it("stops listening once released", async () => {
    const { request } = fakeWakeLock();
    keepScreenOn()();
    await flush();
    setVisibility("hidden");
    setVisibility("visible");
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("does nothing where there is no wake lock, or when the phone refuses", async () => {
    expect(() => keepScreenOn()()).not.toThrow();
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true, value: { request: vi.fn().mockRejectedValue(new Error("NotAllowedError")) },
    });
    const letSleep = keepScreenOn();
    await flush();
    expect(() => letSleep()).not.toThrow();
  });
});
