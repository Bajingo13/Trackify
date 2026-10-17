import { afterEach, describe, expect, it, vi } from "vitest";
import { notifySuccess, onHardwareBack, tap } from "./native";

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
